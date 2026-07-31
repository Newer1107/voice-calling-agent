"""Simulate a browser participant: join a LiveKit Cloud room, publish audio,
verify the agent joins, then exit. Uses the same token endpoint as the UI.
"""
import asyncio
import json
import sys
import time
import urllib.request

import livekit.rtc as rtc

ROOM = sys.argv[1] if len(sys.argv) > 1 else "e2e-test"


def get_token(room: str) -> str:
    req = urllib.request.Request(
        "http://localhost:8090/token",
        data=json.dumps({"roomName": room, "identity": "e2e-sim"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())["token"]


async def main() -> None:
    token = get_token(ROOM)
    print(f"got token for {ROOM}", flush=True)
    room = rtc.Room()
    await room.connect("wss://project-y6rhyuj0.livekit.cloud", token)
    print("joined livekit cloud", flush=True)

    # publish a silent audio track so the agent sees a subscribed audio source
    source = rtc.AudioSource(24000, 1)
    track = rtc.LocalAudioTrack.create_audio_track("sim-mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    silence = bytes(2400)  # 50ms of zeros, 16-bit mono 24k
    frame = rtc.AudioFrame(data=silence, sample_rate=24000, num_channels=1, samples_per_channel=1200)
    for _ in range(5):
        await asyncio.sleep(0.05)
        await source.capture_frame(frame)

    # watch for the agent participant
    seen_agent = False
    for _ in range(60):  # up to 30s
        for p in room.remote_participants.values():
            name = p.name or p.identity
            if "agent" in name.lower() or "voice" in name.lower():
                print(f"AGENT JOINED: {p.identity} (name={p.name})", flush=True)
                seen_agent = True
                break
        if seen_agent:
            break
        await asyncio.sleep(0.5)

    print("RESULT: agent-seen" if seen_agent else "RESULT: agent-not-seen", flush=True)
    await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
