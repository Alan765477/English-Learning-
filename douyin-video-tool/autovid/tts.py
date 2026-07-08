"""Edge TTS 配音(免费)。失败时返回 False,流水线自动降级为无配音。"""
import asyncio
from pathlib import Path


def synth(text: str, dest: Path, cfg: dict) -> bool:
    voice = cfg["tts"]["voice"]
    rate = cfg["tts"].get("rate", "+0%")
    try:
        import edge_tts

        async def _run():
            tts = edge_tts.Communicate(text, voice, rate=rate)
            await tts.save(str(dest))

        asyncio.run(_run())
        return dest.exists() and dest.stat().st_size > 0
    except Exception as e:
        print(f"  [警告] 配音失败:{e}")
        return False
