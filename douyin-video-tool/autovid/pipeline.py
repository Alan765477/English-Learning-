"""流水线编排:文案 → 素材 → 配音 → 剪辑 → 成品 + 发布文案。"""
import datetime
import re
import shutil
from pathlib import Path

from . import config as cfg_mod
from . import editor, llm, stock, tts

DEMO_CONTENT = {
    "title": "3个表达让你口语翻倍",
    "caption": "每天2分钟,轻松学英语!今天这3个表达超实用,评论区告诉我你最想学哪句👇",
    "hashtags": ["#英语学习", "#英语口语", "#每日英语", "#学习方法", "#涨知识"],
    "scenes": [
        {"voiceover": "还在说 very good?这三个表达让你的英语立刻高级起来。", "search_keywords": "demo"},
        {"voiceover": "第一个,awesome,超棒!老外每天都在用,比 very good 地道十倍。", "search_keywords": "demo"},
        {"voiceover": "觉得有用就点个关注,每天两分钟,轻松学英语!", "search_keywords": "demo"},
    ],
}


def _slug(text: str, limit: int = 24) -> str:
    s = re.sub(r"[^\w一-鿿]+", "-", text).strip("-")
    return s[:limit] or "video"


def _write_copy_files(workdir: Path, content: dict, sources: list):
    tags = " ".join(content["hashtags"])
    copy_text = (
        f"【标题】\n{content['title']}\n\n"
        f"【文案】\n{content['caption']}\n\n"
        f"【标签】\n{tags}\n\n"
        f"【发布文案(可直接整段粘贴)】\n{content['caption']} {tags}\n"
    )
    (workdir / "文案.txt").write_text(copy_text, encoding="utf-8")
    if sources:
        lines = ["本视频素材均来自 Pexels(免费商用许可):", ""]
        for i, s in enumerate(sources, 1):
            if s:
                fps = f"{s['fps']:.0f}fps" if s.get("fps") else "?fps"
                lines.append(f"分镜{i}: {s['url']}  ({s['w']}x{s['h']} {fps})")
        (workdir / "素材来源.txt").write_text("\n".join(lines), encoding="utf-8")


def run_links_only(idea: str, cfg: dict, out_dir=None) -> Path:
    """只生成文案 + 找素材链接,不下载不剪辑,方便用户自己下载后手动编辑。"""
    n_scenes = cfg["video"]["scenes"]
    print("[1/2] 正在用 DeepSeek 生成标题、文案、标签和分镜脚本...")
    content = llm.generate_content(idea, n_scenes, cfg)
    print(f"      标题:{content['title']}")

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    base = Path(out_dir) if out_dir else (cfg_mod.TOOL_DIR / "output")
    workdir = base / f"{ts}_{_slug(content['title'])}_仅链接"
    workdir.mkdir(parents=True, exist_ok=True)

    print(f"[2/2] 正在从 Pexels 为 {len(content['scenes'])} 个分镜各找 3 条候选素材...")
    used_ids: set = set()
    lines = ["每个分镜给出最多 3 条候选(已按贴合度排序)。",
             "「页面」是 Pexels 预览页,「直链」复制到浏览器可直接下载 mp4。", ""]
    for i, s in enumerate(content["scenes"], 1):
        lines.append(f"—— 分镜{i} ——")
        lines.append(f"口播:{s['voiceover']}")
        lines.append(f"搜索词:{s['search_keywords']}")
        cands = stock.find_candidates(s["search_keywords"], used_ids, cfg, limit=3)
        if not cands:
            lines.append("(没找到合适素材,建议换个更具体的想法重试)")
        for j, c in enumerate(cands, 1):
            fps = f"{c['fps']:.0f}fps" if c["fps"] else "?fps"
            lines.append(f"  候选{j}: {c['w']}x{c['h']} {fps} {c['duration']}秒")
            lines.append(f"    页面: {c['page_url']}")
            lines.append(f"    直链: {c['download_url']}")
        if cands:
            used_ids.add(cands[0]["id"])  # 默认首选不跨分镜重复
        lines.append("")
        print(f"      分镜{i}: 找到 {len(cands)} 条候选")
    (workdir / "素材链接.txt").write_text("\n".join(lines), encoding="utf-8")
    _write_copy_files(workdir, content, [])

    print()
    print("完成!")
    print(f"  素材链接:{workdir / '素材链接.txt'}")
    print(f"  发布文案:{workdir / '文案.txt'}")
    return workdir


def run(idea: str | None, cfg: dict, *, demo=False, no_tts=False, keep_temp=False, out_dir=None) -> Path:
    n_scenes = cfg["video"]["scenes"]
    font_file, font_name = cfg_mod.find_font(cfg)

    # ---------- 1. 文案与分镜 ----------
    if demo:
        print("[1/4] demo 模式:使用内置演示文案(不调用 DeepSeek)")
        content = DEMO_CONTENT
    else:
        print("[1/4] 正在用 DeepSeek 生成标题、文案、标签和分镜脚本...")
        content = llm.generate_content(idea, n_scenes, cfg)
    scenes = content["scenes"]
    print(f"      标题:{content['title']}")
    for i, s in enumerate(scenes, 1):
        print(f"      分镜{i}: {s['voiceover'][:30]}...")

    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    base = Path(out_dir) if out_dir else (cfg_mod.TOOL_DIR / "output")
    workdir = base / f"{ts}_{_slug(content['title'])}"
    temp = workdir / "temp"
    temp.mkdir(parents=True, exist_ok=True)

    # ---------- 2. 素材 ----------
    clips, sources = [], []
    used_ids: set = set()
    if demo:
        print("[2/4] demo 模式:生成本地演示素材(不调用 Pexels)")
        for i in range(len(scenes)):
            clip = temp / f"clip_{i}.mp4"
            editor.make_demo_clip(clip, 8, i, cfg)
            clips.append(clip)
            sources.append(None)
    else:
        print(f"[2/4] 正在从 Pexels 下载 {len(scenes)} 段高清素材...")
        for i, s in enumerate(scenes):
            clip = temp / f"clip_{i}.mp4"
            info = stock.fetch_clip(s["search_keywords"], clip, used_ids, cfg)
            if info is None:
                raise SystemExit(
                    f"分镜{i + 1} 找不到可用素材(关键词:{s['search_keywords']})。"
                    "请换个想法重试,或减少分镜数。"
                )
            fps = f"{info['fps']:.0f}fps" if info.get("fps") else ""
            print(f"      分镜{i + 1}: {info['w']}x{info['h']} {fps}  ({s['search_keywords']})")
            clips.append(clip)
            sources.append(info)

    # ---------- 3. 配音 ----------
    voices: list = [None] * len(scenes)
    if no_tts:
        print("[3/4] 已按 --no-tts 跳过配音(成片只有字幕)")
    else:
        print("[3/4] 正在用 Edge TTS 生成配音(免费)...")
        for i, s in enumerate(scenes):
            mp3 = temp / f"voice_{i}.mp3"
            if tts.synth(s["voiceover"], mp3, cfg):
                voices[i] = mp3
            else:
                print("      配音服务不可用,本次成片将不带配音(字幕仍会烧录)")
                voices = [None] * len(scenes)
                break

    # ---------- 4. 剪辑 ----------
    print("[4/4] 正在剪辑:竖屏裁剪、烧录字幕、拼接混音...")
    segments = []
    for i, s in enumerate(scenes):
        seg = temp / f"scene_{i}.mp4"
        editor.build_scene(clips[i], voices[i], s["voiceover"], seg, cfg, font_file, font_name)
        segments.append(seg)
        print(f"      分镜{i + 1}/{len(scenes)} 完成")
    final = workdir / "成品.mp4"
    editor.concat(segments, final)

    _write_copy_files(workdir, content, sources)
    if not keep_temp:
        shutil.rmtree(temp, ignore_errors=True)

    dur = editor.media_duration(final)
    size_mb = final.stat().st_size / 1024 / 1024
    print()
    print("完成!")
    print(f"  成品视频:{final}  ({dur:.1f}秒, {size_mb:.1f}MB, "
          f"{cfg['video']['width']}x{cfg['video']['height']} {cfg['video']['fps']}fps)")
    print(f"  发布文案:{workdir / '文案.txt'}")
    print()
    print("下一步:打开抖音创作者中心 https://creator.douyin.com/ → 发布视频 →")
    print("上传成品.mp4,粘贴文案.txt 里的内容,选好位置和封面,点发布(或定时发布)。")
    return workdir
