#!/bin/bash
# Idempotent startup for the whole voice-agent stack. Safe to run any time:
# it (re)creates the tmux sessions and starts Postgres if it is not running.
set -u
export HOME=${HOME:-/home/raunak}
export LD_LIBRARY_PATH=$HOME/pgsetup/usr/lib/x86_64-linux-gnu:$HOME/pgsetup/usr/lib/postgresql/18/lib
PGBIN=$HOME/pgsetup/usr/lib/postgresql/18/bin

# PostgreSQL (Docker container, restart=unless-stopped — just ensure it is up)
if ! bash -c "echo rooor | sudo -S docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'voice-postgres'"; then
  bash -c "echo rooor | sudo -S docker start voice-postgres" >/dev/null 2>&1
  echo "voice-postgres container started"
fi
for i in $(seq 1 15); do
  bash -c "echo rooor | sudo -S docker exec voice-postgres pg_isready -U postgres" >/dev/null 2>&1 && break
  sleep 2
done

# TTS wrapper
tmux kill-session -t tts 2>/dev/null
tmux new-session -d -s tts -c "$HOME/voice-calling-agent/agent" '.venv/bin/python kokoro-server.py 2>&1 | tee /tmp/kokoro.log'

# Agent
tmux kill-session -t agent 2>/dev/null
tmux new-session -d -s agent -c "$HOME/voice-calling-agent/agent" '.venv/bin/agent-run start 2>&1 | tee /tmp/agent.log'

# Frontend
tmux kill-session -t frontend 2>/dev/null
tmux new-session -d -s frontend -c "$HOME/voice-calling-agent/frontend" 'npx next start -p 3000 2>&1 | tee /tmp/frontend.log'

echo "stack started: $(date)"
