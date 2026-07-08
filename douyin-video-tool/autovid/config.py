"""配置加载:config.json + 环境变量覆盖 + 中文字体自动探测。"""
import json
import os
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent

DEFAULTS = {
    "llm": {"base_url": "https://api.deepseek.com", "model": "deepseek-chat"},
    "video": {"width": 1080, "height": 1920, "fps": 60, "scenes": 5, "min_scene_seconds": 3.0},
    "tts": {"voice": "zh-CN-XiaoxiaoNeural", "rate": "+10%", "azure_key": "", "azure_region": ""},
    "subtitle": {
        "font_size": 62,
        "margin_v": 320,
        "position": "bottom",
        "color": "FFFFFF",
        "outline_color": "000000",
        "outline_width": 4,
        "bold": True,
        "font_file": "",
        "font_name": "",
    },
}

# 各平台常见中文字体:(文件路径, libass 使用的字体族名)
COMMON_FONTS = [
    (r"C:\Windows\Fonts\msyh.ttc", "Microsoft YaHei"),
    (r"C:\Windows\Fonts\msyhbd.ttc", "Microsoft YaHei"),
    (r"C:\Windows\Fonts\simhei.ttf", "SimHei"),
    ("/System/Library/Fonts/PingFang.ttc", "PingFang SC"),
    ("/System/Library/Fonts/STHeiti Medium.ttc", "Heiti SC"),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "WenQuanYi Zen Hei"),
    ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", "WenQuanYi Micro Hei"),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "Noto Sans CJK SC"),
    ("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", "Noto Sans CJK SC"),
]


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config() -> dict:
    cfg_path = TOOL_DIR / "config.json"
    cfg = dict(DEFAULTS)
    if cfg_path.exists():
        try:
            user_cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            sys.exit(f"config.json 格式错误:{e}\n请检查 {cfg_path}")
        cfg = _deep_merge(cfg, user_cfg)

    # 环境变量优先级最高,方便临时覆盖
    if os.environ.get("DEEPSEEK_API_KEY"):
        cfg["deepseek_api_key"] = os.environ["DEEPSEEK_API_KEY"]
    if os.environ.get("PEXELS_API_KEY"):
        cfg["pexels_api_key"] = os.environ["PEXELS_API_KEY"]
    return cfg


def require_keys(cfg: dict, need_llm=True, need_pexels=True):
    """检查 key 是否已配置,没配就给出可操作的中文报错。"""
    problems = []
    if need_llm:
        key = cfg.get("deepseek_api_key", "")
        if not key or "填" in key or not key.startswith("sk-"):
            problems.append("DeepSeek API key 未配置(config.json 的 deepseek_api_key,应以 sk- 开头)")
    if need_pexels:
        key = cfg.get("pexels_api_key", "")
        if not key or "填" in key:
            problems.append("Pexels API key 未配置(config.json 的 pexels_api_key)")
    if problems:
        example = TOOL_DIR / "config.example.json"
        sys.exit(
            "缺少配置:\n  - " + "\n  - ".join(problems)
            + f"\n\n请复制 {example.name} 为 config.json 并填入你的 key(该文件已被 .gitignore 忽略,不会上传)。"
        )


def find_font(cfg: dict):
    """返回 (字体文件路径或 None, 字体族名)。优先用户配置,其次探测常见系统字体。"""
    sub = cfg.get("subtitle", {})
    if sub.get("font_file"):
        p = Path(sub["font_file"])
        if p.exists():
            return str(p), sub.get("font_name") or "sans-serif"
        print(f"[警告] 配置的字体文件不存在:{p},改为自动探测")
    for path, name in COMMON_FONTS:
        if Path(path).exists():
            return path, sub.get("font_name") or name
    print("[警告] 未找到中文字体,字幕可能显示为方块。请在 config.json 的 subtitle.font_file 指定字体文件。")
    return None, sub.get("font_name") or "sans-serif"
