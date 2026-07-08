"""DeepSeek 文案生成:想法 → 标题/文案/标签/分镜(口播+英文素材关键词)。"""
import json
import re
import time

import requests

SYSTEM_PROMPT = """你是一名资深抖音短视频编导,擅长把一个想法变成完整的竖屏短视频方案。
用户给你一个视频想法,你输出严格的 JSON(不要多余文字),格式如下:

{
  "title": "视频标题,15字以内,有钩子有悬念,不带标签",
  "caption": "发布文案,2~4句话,口语化有网感,可以带少量emoji,结尾引导互动",
  "hashtags": ["#话题1", "#话题2"],
  "scenes": [
    {
      "voiceover": "这个分镜的口播文案,一到两句话,口语化",
      "search_keywords": "english stock video keywords"
    }
  ]
}

要求:
- hashtags 给 5~8 个,都以 # 开头,前2个用大流量泛话题,后面用精准垂类话题
- scenes 数量必须正好等于用户要求的分镜数
- 所有分镜的 voiceover 连起来是一段完整流畅的口播稿:第一个分镜必须是强钩子(前3秒留住人),最后一个分镜引导点赞关注
- 每条 voiceover 控制在 25~45 个汉字,念出来约 5~8 秒
- search_keywords 用 2~4 个英文单词,描述适合这段口播的「画面」,必须是 Pexels 这类素材网站容易搜到的通用实拍场景(如 city night aerial / person studying laptop),不要出现品牌名、明星名、文字特效类词
"""


def _extract_json(text: str) -> dict:
    """兼容模型偶尔在 JSON 外包裹 ```json 代码块的情况。"""
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if m:
        text = m.group(1)
    return json.loads(text)


def _validate(data: dict, n_scenes: int) -> dict:
    if not isinstance(data.get("title"), str) or not data["title"].strip():
        raise ValueError("缺少 title")
    if not isinstance(data.get("caption"), str) or not data["caption"].strip():
        raise ValueError("缺少 caption")
    tags = data.get("hashtags")
    if not isinstance(tags, list) or not tags:
        raise ValueError("缺少 hashtags")
    data["hashtags"] = [t if str(t).startswith("#") else f"#{t}" for t in tags]
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("缺少 scenes")
    for s in scenes:
        if not s.get("voiceover") or not s.get("search_keywords"):
            raise ValueError("scene 缺少 voiceover 或 search_keywords")
    if len(scenes) != n_scenes:
        # 数量不符时不作硬失败:多了截断,少了照用
        data["scenes"] = scenes[:n_scenes]
    return data


def generate_content(idea: str, n_scenes: int, cfg: dict) -> dict:
    llm = cfg["llm"]
    url = llm["base_url"].rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['deepseek_api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": llm["model"],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"视频想法:{idea}\n分镜数:{n_scenes}"},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 2500,
        "temperature": 1.2,
    }

    last_err = None
    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=120)
            if resp.status_code == 401:
                raise SystemExit("DeepSeek 返回 401:API key 无效,请检查 config.json 的 deepseek_api_key")
            if resp.status_code == 402:
                raise SystemExit("DeepSeek 返回 402:账户余额不足,请到 platform.deepseek.com 充值")
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            return _validate(_extract_json(content), n_scenes)
        except SystemExit:
            raise
        except Exception as e:  # 网络抖动 / JSON 偶发不合规,重试
            last_err = e
            if attempt < 2:
                wait = 2 ** (attempt + 1)
                print(f"  [重试] DeepSeek 调用失败({e}),{wait}秒后重试...")
                time.sleep(wait)
    raise SystemExit(f"DeepSeek 调用连续失败:{last_err}")
