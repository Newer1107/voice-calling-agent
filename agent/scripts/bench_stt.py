"""STT benchmark: phrases -> Kokoro TTS -> LiveKit -> final transcript.

Publishes each ground-truth phrase as synthesized speech (Kokoro on :8880),
streams it into a LiveKit room as the user mic, and listens on the data
channel for the agent's `transcript.final`. Measures:

- latency_ms: time from the last audio frame sent to transcript.final
- WER: jiwer word error rate of the transcript vs the ground-truth phrase

Run against the agent with any STT_PROVIDER (whisper or deepgram); the
agent's env decides which backend is being measured. Results are printed as
a table and appended to agent/benchmark/results/<label>.jsonl.

Usage:
    python scripts/bench_stt.py [label] [--phrases p1|p2|...]
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
import urllib.request
from pathlib import Path

import livekit.rtc as rtc
from jiwer import wer

ROOM_PREFIX = "bench-stt"
AGENT_TOKEN_URL = "http://localhost:8090/token"
TTS_URL = "http://localhost:8880/tts"
RESULTS_DIR = Path(__file__).resolve().parent.parent / "benchmark" / "results"

DEFAULT_PHRASES = [
    "Hi my name is Ravi",
    "Book me a Swedish massage for tomorrow afternoon",
    "How much to upgrade to Platinum",
    "When does my membership expire",
    "Book a yoga class on Friday",
    "Order two protein shakes and a gym tee",
    "Is the sauna available tomorrow morning",
    "Cancel all my bookings",
    "Email me today's class schedule",
    "My name is Sarah what do I have booked",
]


def get_token(room: str) -> str:
    req = urllib.request.Request(
        AGENT_TOKEN_URL,
        data=json.dumps({"roomName": room, "identity": "bench-sim"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=10).read())["token"]


def synth(text: str) -> bytes:
    req = urllib.request.Request(
        TTS_URL,
        data=json.dumps({"text": text, "voice": "af_heart", "speed": 1.0}).encode(),
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
    raise ValueError("no data chunk in wav")


async def run_phrase(phrase: str, room_name: str, finals: dict[str, tuple[str, float]]) -> tuple[str, float] | None:
    wav = synth(phrase)
    pcm, rate, channels = wav_to_pcm16(wav)
    room = rtc.Room()

    def on_data(data: rtc.DataReceivedEvent) -> None:
        try:
            msg = json.loads(data.data.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            return
        if isinstance(msg, dict) and msg.get("type") == "transcript.final":
            text = (msg.get("payload") or {}).get("text", "")
            finals[msg.get("sessionId", "")] = (text, time.monotonic())

    room.on("data_received", on_data)
    await room.connect("wss://project-y6rhyuj0.livekit.cloud", get_token(room_name))
    source = rtc.AudioSource(rate, channels)
    track = rtc.LocalAudioTrack.create_audio_track("bench-mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    chunk = rate * channels * 2 // 20
    for i in range(0, len(pcm), chunk):
        piece = pcm[i : i + chunk]
        if len(piece) < chunk:
            piece = piece + b"\x00" * (chunk - len(piece))
        frame = rtc.AudioFrame(
            data=piece,
            sample_rate=rate,
            num_channels=channels,
            samples_per_channel=len(piece) // (2 * channels),
        )
        await source.capture_frame(frame)
        await asyncio.sleep(0.05)
    last_sent = time.monotonic()

    deadline = last_sent + 30.0
    while time.monotonic() < deadline:
        if finals:
            _, (text, final_at) = finals.popitem()
            latency_ms = (final_at - last_sent) * 1000
            await room.disconnect()
            return (text, latency_ms) if text else None
        await asyncio.sleep(0.05)
    await room.disconnect()
    return None


def main() -> None:
    label = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "stt"
    phrases = DEFAULT_PHRASES
    if "--phrases" in sys.argv:
        idx = sys.argv.index("--phrases")
        phrases = [p.replace("|", " ") for p in sys.argv[idx + 1].split("|")]

    results: list[dict[str, object]] = []
    print(f"\n=== STT benchmark ({label}) — {len(phrases)} phrases ===")
    print(f"{'phrase':<52} {'wer':>6} {'latency(ms)':>12}")
    print("-" * 74)

    async def run_all() -> None:
        for i, phrase in enumerate(phrases):
            room_name = f"{ROOM_PREFIX}-{label}-{i}"
            finals: dict[str, tuple[str, float]] = {}
            got = await run_phrase(phrase, room_name, finals)
            if got is None:
                row = {"phrase": phrase, "wer": None, "latency_ms": None}
                results.append(row)
                print(f"{phrase:<52} {'TIMEOUT':>6} {'-':>12}")
                continue
            text, latency_ms = got
            w = wer(phrase.lower(), text.lower()) if text else 1.0
            row = {"phrase": phrase, "transcript": text, "wer": round(w, 4), "latency_ms": round(latency_ms, 1)}
            results.append(row)
            print(f"{phrase:<52} {w:>6.3f} {latency_ms:>12.0f}")
            if text:
                print(f"    transcript: {text}")

    asyncio.run(run_all())

    scored = [r for r in results if r["wer"] is not None]
    if scored:
        avg_wer = sum(float(r["wer"]) for r in scored) / len(scored)
        avg_lat = sum(float(r["latency_ms"]) for r in scored) / len(scored)
        print("-" * 74)
        print(f"AVERAGE    wer={avg_wer:.3f}  latency={avg_lat:.0f}ms  ({len(scored)}/{len(phrases)} transcribed)")
        summary = {"label": label, "avg_wer": round(avg_wer, 4), "avg_latency_ms": round(avg_lat, 1), "results": results}
    else:
        summary = {"label": label, "avg_wer": None, "avg_latency_ms": None, "results": results}
        print("no phrases transcribed — check agent / TTS / network")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"{label}.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nsaved -> {out}")


if __name__ == "__main__":
    main()
