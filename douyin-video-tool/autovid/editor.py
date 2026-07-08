"""ffmpeg 剪辑:裁成竖屏、按口播时长截取、烧录字幕、拼接、混音。

ffmpeg 可执行文件由 imageio-ffmpeg 提供,用户无需单独安装。
"""
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def _run(args: list, what: str):
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-8:])
        raise SystemExit(f"ffmpeg {what} 失败:\n{tail}")


def media_duration(path: Path) -> float:
    """用 ffmpeg -i 的输出解析时长(imageio-ffmpeg 不带 ffprobe)。"""
    proc = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", proc.stderr)
    if not m:
        raise SystemExit(f"无法读取时长:{path}")
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


def _filter_path(p) -> str:
    """把路径转义成能安全嵌入 ffmpeg 滤镜参数的形式(兼容 Windows 盘符冒号)。"""
    s = str(Path(p).resolve()).replace("\\", "/")
    return s.replace(":", "\\:").replace("'", "\\'")


def _ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int(seconds % 3600 // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def write_ass(text: str, duration: float, dest: Path, cfg: dict, font_name: str):
    """整个分镜期间常显的一条字幕(白字黑边、底部安全区上方)。"""
    sub = cfg["subtitle"]
    content = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {cfg['video']['width']}
PlayResY: {cfg['video']['height']}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{font_name},{sub['font_size']},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,70,70,{sub['margin_v']},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,{_ass_time(0)},{_ass_time(duration)},Sub,,0,0,0,,{text}
"""
    dest.write_text(content, encoding="utf-8")


def build_scene(
    clip: Path,
    voice: Path | None,
    subtitle_text: str,
    out: Path,
    cfg: dict,
    font_file: str | None,
    font_name: str,
):
    """把一段素材做成成品分镜:竖屏裁剪 + 统一帧率 + 烧字幕 + 配音(或静音)。"""
    v = cfg["video"]
    w, h, fps = v["width"], v["height"], v["fps"]

    # 分镜时长 = 配音时长 + 0.4 秒呼吸感,且不短于配置下限
    if voice is not None:
        dur = max(media_duration(voice) + 0.4, v["min_scene_seconds"])
    else:
        dur = max(v["min_scene_seconds"], 4.0)

    # 素材比需要的短就无缝循环
    clip_dur = media_duration(clip)
    loop_args = ["-stream_loop", "-1"] if clip_dur < dur + 0.1 else []

    ass_path = out.with_suffix(".ass")
    write_ass(subtitle_text, dur, ass_path, cfg, font_name)
    ass_filter = f"ass='{_filter_path(ass_path)}'"
    if font_file:
        ass_filter += f":fontsdir='{_filter_path(Path(font_file).parent)}'"

    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},setsar=1,fps={fps},{ass_filter}"
    )

    args = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error"]
    args += loop_args + ["-i", str(clip)]
    if voice is not None:
        args += ["-i", str(voice)]
    else:
        args += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
    args += [
        "-map", "0:v:0", "-map", "1:a:0",
        "-vf", vf,
        "-af", "apad",           # 配音比画面短时补静音,保证音画等长
        "-t", f"{dur:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        str(out),
    ]
    _run(args, f"渲染分镜 {out.name}")


def concat(segments: list, out: Path):
    """无损拼接所有分镜(编码参数一致,直接流复制)。"""
    list_file = out.parent / "concat.txt"
    lines = []
    for seg in segments:
        p = str(Path(seg).resolve()).replace("'", "'\\''")
        lines.append(f"file '{p}'")
    list_file.write_text("\n".join(lines), encoding="utf-8")
    _run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c", "copy", str(out)],
        "拼接成片",
    )


def make_demo_clip(dest: Path, seconds: float, variant: int, cfg: dict):
    """demo 模式:不联网,用 ffmpeg 自带的测试画面生成素材。"""
    v = cfg["video"]
    src = f"testsrc2=size={v['width']}x{v['height']}:rate=30:duration={seconds}"
    hue = f"hue=h={variant * 90}:s=2"
    _run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", src, "-vf", hue,
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
         str(dest)],
        "生成演示素材",
    )
