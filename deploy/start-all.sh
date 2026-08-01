#!/bin/bash
# Idempotent startup for the whole voice-agent stack. Safe to run any time:
# it (re)creates the tmux sessions and starts Postgres if it is not running.
set -u
export HOME=${HOME:-/home/raunak}
export LD_LIBRARY_PATH=$HOME/pgsetup/usr/lib/x86_64-linux-gnu:$HOME/pgsetup/usr/lib/postgresql/18/lib
PGBIN=$HOME/pgsetup/usr/lib/postgresql/18/bin

# PostgreSQL (user-space install, no auto-start on its own)
if [ -x "$PGBIN/pg_ctl" ] && ! "$PGBIN/pg_ctl" -D "$HOME/pgdata" status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$HOME/pgdata" -l /tmp/pg.log -w start >/dev/null 2>&1
  echo "postgres started"
fi

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
