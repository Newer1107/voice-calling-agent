"""TTS HTTP wrapper — exposes POST /tts -> WAV for the voice agent.

Contract (agent/src/voice_agent/clients/kokoro.py): POST /tts with JSON
{"text", "voice", "speed"} returns 200 with an audio/wav body (16-bit PCM).

Engine: Microsoft Edge neural voices (edge-tts) — this is where the Indian
English voices live (en-IN-NeerjaNeural, en-IN-PrabhatNeural). If the
requested voice is not an Edge voice, or Edge synthesis fails, falls back to
the local Kokoro-82M model so TTS never goes down with the network.
"""
import asyncio
import io
from fastapi import FastAPI, Response
from pydantic import BaseModel

import edge_tts
import imageio_ffmpeg
from kokoro import KPipeline
import soundfile as sf

app = FastAPI(title="TTS")
pipeline = KPipeline(lang_code="a")  # American English (kokoro fallback)
_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
_EDGE_TIMEOUT_S = 12.0
_KOKORO_FALLBACK_VOICE = "af_bella"


class TTSReq(BaseModel):
    text: str
    voice: str = "af_bella"
    speed: float = 1.0


def _edge_rate(speed: float) -> str:
    """Map agent speed (1.0 = normal) to edge-tts rate string."""
    return f"{int(round((speed - 1.0) * 100)):+d}%"


async def _edge_synth(text: str, voice: str, speed: float) -> bytes | None:
    """Synthesize via edge-tts and convert MP3 -> 24kHz mono WAV."""
    com = edge_tts.Communicate(text, voice, rate=_edge_rate(speed))
    buf = io.BytesIO()
    async for chunk in com.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    mp3 = buf.getvalue()
    if not mp3:
        return None
    proc = await asyncio.create_subprocess_exec(
        _FFMPEG, "-y", "-loglevel", "error", "-i", "pipe:0",
        "-ar", "24000", "-ac", "1", "-f", "wav", "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate(mp3)
    return out or None


@app.post("/tts")
async def tts(req: TTSReq):
    if req.voice.startswith("en-"):
        try:
            wav = await asyncio.wait_for(
                _edge_synth(req.text, req.voice, req.speed), timeout=_EDGE_TIMEOUT_S
            )
            if wav:
                return Response(content=wav, media_type="audio/wav")
        except Exception:
            pass  # fall through to kokoro
    wav = io.BytesIO()
    for result in pipeline(req.text, voice=_KOKORO_FALLBACK_VOICE, speed=req.speed):
        if result.audio is not None and len(result.audio):
            sf.write(wav, result.audio, 24000, format="WAV")
    return Response(content=wav.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8880, log_level="warning")
