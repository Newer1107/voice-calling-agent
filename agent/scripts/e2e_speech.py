"""True end-to-end: publish REAL speech (from Kokoro) as the user mic.

Agent should: hear audio -> Whisper transcribe -> Ollama -> (tools) -> reply
-> Kokoro TTS. We can't hear the reply, but we verify the agent's log shows
user_speech + an agent reply event, and /history shows the conversation.
"""
import asyncio
import json
import sys
import urllib.request

import livekit.rtc as rtc

ROOM = sys.argv[1] if len(sys.argv) > 1 else "e2e-speech"
UTTERANCE = sys.argv[2] if len(sys.argv) > 2 else (
    "I would like to book a yoga class tomorrow evening at six thirty for Sarah please"
)
VOICE = sys.argv[3] if len(sys.argv) > 3 else "af_heart"


def get_token(room: str) -> str:
    req = urllib.request.Request(
        "http://localhost:8090/token",
        data=json.dumps({"roomName": room, "identity": "speech-sim"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=10).read())["token"]


def synth(text: str) -> bytes:
    req = urllib.request.Request(
        "http://localhost:8880/tts",
        data=json.dumps({"text": text, "voice": VOICE, "speed": 1.0}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return urllib.request.urlopen(req, timeout=60).read()


def wav_to_pcm16(wav: bytes) -> tuple[bytes, int, int]:
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    offset, sample_rate, channels = 12, 24000, 1
    while offset + 8 <= len(wav):
        cid = wav[offset : offset + 4]
        size = int.from_bytes(wav[offset + 4 : offset + 8], "little")
        if cid == b"fmt ":
            sample_rate = int.from_bytes(wav[offset + 12 : offset + 14], "little")
            channels = int.from_bytes(wav[offset + 10 : offset + 12], "little")
        if cid == b"data":
            return wav[offset + 8 : offset + 8 + size], sample_rate, channels
        offset += 8 + size + (size % 2)
    raise ValueError("no data chunk")


async def main() -> None:
    print("synthesizing user speech...", flush=True)
    wav = synth(UTTERANCE)
    pcm, rate, channels = wav_to_pcm16(wav)
    print(f"user speech: {len(pcm)} bytes @ {rate}Hz {channels}ch", flush=True)

    room = rtc.Room()
    await room.connect("wss://project-y6rhyuj0.livekit.cloud", get_token(ROOM))
    print("joined; publishing mic with real speech", flush=True)

    source = rtc.AudioSource(rate, channels)
    track = rtc.LocalAudioTrack.create_audio_track("sim-mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )

    # stream the speech in 50ms chunks like a real mic
    chunk = rate * channels * 2 // 20  # 50ms
    frame_sr = rate
    for i in range(0, len(pcm), chunk):
        piece = pcm[i : i + chunk]
        if len(piece) < chunk:
            piece = piece + b"\x00" * (chunk - len(piece))
        fr = rtc.AudioFrame(
            data=piece, sample_rate=frame_sr, num_channels=channels, samples_per_channel=len(piece) // (2 * channels)
        )
        await source.capture_frame(fr)
        await asyncio.sleep(0.05)

    print("speech sent; waiting 45s for the agent pipeline", flush=True)
    await asyncio.sleep(45)
    await room.disconnect()
    print("done", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
