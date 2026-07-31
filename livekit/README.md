# livekit/

LiveKit server configuration and helper material for the **VPS** (Machine 1).
This folder is used only on the public VPS — the Home Server and AI Server do
not run LiveKit.

LiveKit is the realtime media transport: the browser publishes its microphone
to a room, the Python agent (on the Home Server, joined to the same room)
receives it, and streamed TTS audio comes back the same way. The browser also
uses LiveKit's data channel for realtime state events (see
`../shared/schemas/events.schema.json`).

## Prerequisites

- A LiveKit server — either [LiveKit Cloud](https://cloud.livekit.io) (managed,
  zero setup) or a self-hosted `livekit-server` binary (see below).
- A hostname the browser can reach over WebSocket (`wss://`). For self-hosted:
  the VPS public IP or a subdomain pointing at it. Ports `7880` (WebRTC) and
  `7881` (TURN/UDP) must be open on the VPS firewall.
- Nothing else. No AI, no database, no speech models on this machine.

## Required environment variables

These are the values the VPS exposes to the other machines. Define them in
`.env` (copy from `.env.example`) — they are what `frontend/` and `agent/`
need to point at LiveKit:

| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | WebSocket URL, e.g. `wss://livekit.example.com` (browser + agent connect here) |
| `LIVEKIT_API_KEY` | API key (server-side signing; shared with `agent/.env`) |
| `LIVEKIT_API_SECRET` | API secret (server-side signing; shared with `agent/.env`) |

## Installation (self-hosted)

```bash
# Download the latest livekit-server release for linux-amd64 from
# https://github.com/livekit/livekit/releases, then:
tar xzf livekit_*.tar.gz
sudo mv livekit-server /usr/local/bin/
```

## Build

Nothing to build — LiveKit is a prebuilt binary.

## Run

```bash
livekit-server --config livekit.yaml
```

Dev-mode one-liner (no config file, ephemeral keys — fine for testing only):

```bash
livekit-server --dev --bind 0.0.0.0
```

`livekit.yaml` is generated from `livekit.yaml.example` — set your own
`keys` and a `node_ip` that matches the VPS public IP when behind NAT.

## Health check

```bash
# The binary is up:
curl -s http://localhost:7880/ | head -c 200

# Verify a room can be created (needs a token; easiest via livekit-cli):
livekit-cli create-token --api-key devkey --api-secret devsecret \
  --join --room test --identity smoke-test
```

If you use LiveKit Cloud, the health check is "your dashboard shows the room
when a client connects" — the frontend's Connect button is the real test.

## Wiring to the rest of the system

- `frontend/.env.local`: `NEXT_PUBLIC_LIVEKIT_URL` = the same `LIVEKIT_URL`.
- `agent/.env`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — the
  agent signs join tokens with these; the browser gets a token from the
  agent's `POST /token`, never the secret itself.
- The agent (Home Server) reaches this server over the Tailscale network; the
  browser reaches it over the public internet. Both use the same `wss://` URL.

## Files

| File | Purpose |
|---|---|
| `livekit.yaml.example` | Self-hosted server config template |
| `.env.example` | The connection values to share with frontend/ and agent/ |
| `README.md` | This file |
