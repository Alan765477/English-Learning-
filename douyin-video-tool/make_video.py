#!/usr/bin/env python3
"""抖音视频自动生产工具:一个想法 → 成品竖屏视频 + 发布文案。

用法:
  python make_video.py "3个让英语口语翻倍的小技巧"
  python make_video.py "秋天去杭州旅行的理由" --scenes 4
  python make_video.py --demo          # 不用任何 key,本地跑通全流程
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from autovid import config as cfg_mod
from autovid import pipeline


def main():
    parser = argparse.ArgumentParser(description="想法 → 抖音成品视频(素材来自 Pexels 免费商用库)")
    parser.add_argument("idea", nargs="?", help="视频想法/主题,用引号包起来")
    parser.add_argument("--scenes", type=int, help="分镜数量(默认取 config.json,通常 5)")
    parser.add_argument("--no-tts", action="store_true", help="不加 AI 配音,只烧字幕")
    parser.add_argument("--links-only", action="store_true",
                        help="只输出文案和素材链接(每个分镜3条候选),不下载不剪辑,自己手动编辑时用")
    parser.add_argument("--demo", action="store_true", help="演示模式:不调用任何 API,验证环境是否正常")
    parser.add_argument("--keep-temp", action="store_true", help="保留中间文件(素材、单段分镜)方便检查")
    parser.add_argument("--output", help="输出目录(默认 douyin-video-tool/output/)")
    args = parser.parse_args()

    if not args.demo and not args.idea:
        parser.error("请提供视频想法,例如:python make_video.py \"3个英语学习技巧\"(或用 --demo 试跑)")

    cfg = cfg_mod.load_config()
    if not args.demo:
        cfg_mod.require_keys(cfg)
    if args.scenes:
        cfg["video"]["scenes"] = max(1, min(args.scenes, 10))

    if args.links_only:
        if not args.idea:
            parser.error("--links-only 需要提供视频想法")
        pipeline.run_links_only(args.idea, cfg, out_dir=args.output)
        return

    pipeline.run(
        args.idea,
        cfg,
        demo=args.demo,
        no_tts=args.no_tts,
        keep_temp=args.keep_temp,
        out_dir=args.output,
    )


if __name__ == "__main__":
    main()
