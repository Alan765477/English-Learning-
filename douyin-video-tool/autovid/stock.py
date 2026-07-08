"""Pexels 素材搜索与下载:竖屏优先、1080p 起步、尽量 60fps、跨分镜去重。"""
import time
from pathlib import Path

import requests

API = "https://api.pexels.com/videos/search"


def _search(query: str, api_key: str, orientation: str | None):
    params = {"query": query, "per_page": 15, "size": "medium"}  # medium = 至少全高清
    if orientation:
        params["orientation"] = orientation
    for attempt in range(3):
        try:
            resp = requests.get(API, headers={"Authorization": api_key}, params=params, timeout=60)
            if resp.status_code == 401:
                raise SystemExit("Pexels 返回 401:API key 无效,请检查 config.json 的 pexels_api_key")
            if resp.status_code == 429:
                print("  [限流] Pexels 请求过快,等 15 秒...")
                time.sleep(15)
                continue
            resp.raise_for_status()
            return resp.json().get("videos", [])
        except SystemExit:
            raise
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
            else:
                print(f"  [警告] Pexels 搜索失败:{e}")
    return []


def _score_file(f: dict, want_w: int, want_h: int):
    """给一个可下载文件打分:分辨率够用 > 高帧率 > 尺寸接近目标(省下载量)。"""
    w, h = f.get("width") or 0, f.get("height") or 0
    fps = f.get("fps") or 0
    if not w or not h:
        return None
    quality_ok = w >= want_w and h >= want_h          # 覆盖 1080x1920,裁剪后不糊
    hd_ok = min(w, h) >= 1080                          # 至少 1080p
    return (quality_ok, hd_ok, fps >= 50, -abs(h - want_h) - abs(w - want_w))


def _pick_file(video: dict, want_w: int, want_h: int):
    best, best_score = None, None
    for f in video.get("video_files", []):
        if f.get("file_type") and "mp4" not in f["file_type"]:
            continue
        s = _score_file(f, want_w, want_h)
        if s and (best_score is None or s > best_score):
            best, best_score = f, s
    return best


def _download(url: str, dest: Path):
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 20):
                fh.write(chunk)


def find_candidates(keywords: str, used_ids: set, cfg: dict, limit: int = 3) -> list:
    """只搜索不下载:返回最多 limit 条候选素材的信息(给用户自己挑选/下载)。"""
    api_key = cfg["pexels_api_key"]
    want_w, want_h = cfg["video"]["width"], cfg["video"]["height"]
    out = []
    for orientation in ("portrait", None):
        for v in _search(keywords, api_key, orientation):
            if v["id"] in used_ids or any(c["id"] == v["id"] for c in out):
                continue
            f = _pick_file(v, want_w, want_h)
            if not f:
                continue
            fps = f.get("fps") or 0
            out.append({
                "id": v["id"],
                "page_url": v.get("url", ""),
                "download_url": f["link"],
                "w": f.get("width"),
                "h": f.get("height"),
                "fps": fps,
                "duration": v.get("duration") or 0,
            })
            if len(out) >= limit:
                return out
        if out:
            break
    return out


def fetch_clip(keywords: str, dest: Path, used_ids: set, cfg: dict) -> dict | None:
    """按关键词找一段素材下载到 dest。返回 {"id","url","fps","w","h"},失败返回 None。"""
    api_key = cfg["pexels_api_key"]
    want_w, want_h = cfg["video"]["width"], cfg["video"]["height"]

    # 逐级降级:原词竖屏 → 原词任意方向 → 简化词 → 通用词
    simplified = " ".join(keywords.split()[:2])
    attempts = [
        (keywords, "portrait"),
        (keywords, None),
        (simplified, "portrait") if simplified != keywords else None,
        ("lifestyle city people", "portrait"),
    ]
    for att in attempts:
        if att is None:
            continue
        query, orientation = att
        videos = _search(query, api_key, orientation)
        for v in sorted(videos, key=lambda x: x.get("duration") or 0, reverse=True):
            if v["id"] in used_ids:
                continue
            f = _pick_file(v, want_w, want_h)
            if not f:
                continue
            try:
                _download(f["link"], dest)
            except Exception as e:
                print(f"  [警告] 下载失败({e}),换下一条素材")
                continue
            used_ids.add(v["id"])
            return {
                "id": v["id"],
                "url": v.get("url", ""),
                "fps": f.get("fps"),
                "w": f.get("width"),
                "h": f.get("height"),
            }
    return None
