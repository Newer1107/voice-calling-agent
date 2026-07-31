"""Kokoro TTS HTTP wrapper — exposes POST /tts -> WAV for the voice agent.

Contract (agent/src/voice_agent/clients/kokoro.py): POST /tts with JSON
{"text", "voice", "speed"} returns 200 with an audio/wav body (16-bit PCM).
"""
import io
from fastapi import FastAPI, Response
from pydantic import BaseModel
from kokoro import KPipeline
import soundfile as sf

app = FastAPI(title="Kokoro TTS")
pipeline = KPipeline(lang_code="a")  # American English


class TTSReq(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0


@app.post("/tts")
async def tts(req: TTSReq):
    wav = io.BytesIO()
    for result in pipeline(req.text, voice=req.voice, speed=req.speed):
        if result.audio is not None and len(result.audio):
            sf.write(wav, result.audio, 24000, format="WAV")
    return Response(content=wav.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8880, log_level="warning")
