#!/bin/bash
# Watchdog: keeps the voice stack alive + the Ollama model warm.
# Runs every 2 minutes via crontab. Only restarts what is actually down.
set -u
export HOME=${HOME:-/home/raunak}
export LD_LIBRARY_PATH=$HOME/pgsetup/usr/lib/x86_64-linux-gnu:$HOME/pgsetup/usr/lib/postgresql/18/lib
PGBIN=$HOME/pgsetup/usr/lib/postgresql/18/bin
AGENT_DIR=$HOME/voice-calling-agent/agent

# 1) Keep the LLM warm on the AI server (Ollama unloads idle models after ~5 min,
#    causing a slow cold-start on the first morning request).
curl -sf -m 20 -X POST http://175.175.0.254:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:3b","prompt":"ping","stream":false,"keep_alive":-1}' \
  -o /dev/null 2>/dev/null || true

# 2) Agent health
if ! curl -sf -m 5 http://localhost:8090/health >/dev/null 2>&1; then
  tmux kill-session -t agent 2>/dev/null
  tmux new-session -d -s agent -c "$AGENT_DIR" '.venv/bin/agent-run start 2>&1 | tee /tmp/agent.log'
  echo "agent restarted: $(date)" >> /tmp/watchdog.log
fi

# 3) Postgres (Docker container)
if ! bash -c "echo rooor | sudo -S docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'voice-postgres'"; then
  bash -c "echo rooor | sudo -S docker start voice-postgres" >/dev/null 2>&1
  echo "voice-postgres restarted: $(date)" >> /tmp/watchdog.log
fi

# 4) TTS wrapper
if ! curl -sf -m 10 -X POST http://localhost:8880/tts -H 'Content-Type: application/json' \
  -d '{"text":"ping","voice":"en-IN-NeerjaNeural","speed":1.0}' -o /dev/null 2>/dev/null; then
  tmux kill-session -t tts 2>/dev/null
  tmux new-session -d -s tts -c "$AGENT_DIR" '.venv/bin/python kokoro-server.py 2>&1 | tee /tmp/kokoro.log'
  echo "tts restarted: $(date)" >> /tmp/watchdog.log
fi

# 5) Frontend
if ! curl -sf -m 5 http://localhost:3000 -o /dev/null 2>/dev/null; then
  tmux kill-session -t frontend 2>/dev/null
  tmux new-session -d -s frontend -c "$HOME/voice-calling-agent/frontend" 'npx next start -p 3000 2>&1 | tee /tmp/frontend.log'
  echo "frontend restarted: $(date)" >> /tmp/watchdog.log
fi

exit 0
