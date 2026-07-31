# shared/

Cross-module contracts for the AI Voice Agent. This directory is the single
source of truth for anything used by more than one component (frontend,
agent, livekit). Each machine clones the whole repo but only consumes the
folders it needs — `shared/` is the one folder both the VPS (via frontend)
and the Home Server (via agent) depend on.

## Layout

| Path | What it pins |
|---|---|
| `schemas/` | JSON Schemas — the canonical, machine-validatable contracts (events, webhook envelopes) |
| `contracts/` | Human-readable contract documents (webhook request/response conventions, tool registry, live endpoints) |
| `types/` | Typed views derived from the schemas (documentation of the event union; the frontend keeps a compiled TS copy) |
| `configuration/env-conventions.md` | Canonical environment variable names for every component |

## Design rules

- **Language-neutral core.** The schemas in `schemas/` are JSON Schema, not
  TS/Python — each side derives its own types. `types/` documents the event
  union; `frontend/lib/types.ts` is the compiled TypeScript mirror and must
  stay in sync with `schemas/events.schema.json`.
- **Events over the LiveKit data channel.** Realtime state (transcripts,
  indicators, tool activity, errors) flows agent → browser as typed messages
  on the data channel. Client → agent messages (push-to-talk, config) use the
  same channel with `client.*` types.
- **n8n via HTTP only.** The agent never calls the n8n API — only configured
  webhook URLs, through the tool manager.
- **Never edit a contract unilaterally.** A change to `schemas/` must be
  mirrored in `frontend/lib/types.ts` (and vice versa).
