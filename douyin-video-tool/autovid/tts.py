"""配音模块,支持两个引擎:

- edge   :Edge TTS,免费、无需注册,但是非官方接口,偶尔不稳定(默认)
- azure  :微软 Azure 语音服务官方接口,稳定、音色更多,需要 Azure key
           (免费层 F0 每月 50 万字符,做短视频足够)

config.json 的 tts 段填了 azure_key + azure_region 就自动优先走 Azure,
Azure 失败时自动回落到 edge-tts;都失败返回 False,流水线降级为无配音。
"""
import asyncio
from pathlib import Path
from xml.sax.saxutils import escape

import requests


def _edge(text: str, dest: Path, voice: str, rate: str) -> bool:
    import edge_tts

    async def _run():
        tts = edge_tts.Communicate(text, voice, rate=rate)
        await tts.save(str(dest))

    asyncio.run(_run())
    return dest.exists() and dest.stat().st_size > 0


def _azure(text: str, dest: Path, voice: str, rate: str, key: str, region: str) -> bool:
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    ssml = (
        "<speak version='1.0' xml:lang='zh-CN'>"
        f"<voice name='{voice}'><prosody rate='{rate}'>{escape(text)}</prosody></voice>"
        "</speak>"
    )
    resp = requests.post(
        url,
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml; charset=utf-8",
            "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
            "User-Agent": "douyin-video-tool",
        },
        data=ssml.encode("utf-8"),
        timeout=60,
    )
    if resp.status_code == 401:
        raise SystemExit("Azure 语音返回 401:azure_key 或 azure_region 不对,请检查 config.json")
    resp.raise_for_status()
    dest.write_bytes(resp.content)
    return dest.stat().st_size > 0


def synth(text: str, dest: Path, cfg: dict) -> bool:
    t = cfg["tts"]
    voice = t["voice"]
    rate = t.get("rate", "+0%")
    azure_key = (t.get("azure_key") or "").strip()
    azure_region = (t.get("azure_region") or "").strip()

    if azure_key and azure_region:
        try:
            return _azure(text, dest, voice, rate, azure_key, azure_region)
        except SystemExit:
            raise
        except Exception as e:
            print(f"  [警告] Azure 配音失败({e}),改用 Edge TTS 重试")

    try:
        return _edge(text, dest, voice, rate)
    except Exception as e:
        print(f"  [警告] 配音失败:{e}")
        return False
