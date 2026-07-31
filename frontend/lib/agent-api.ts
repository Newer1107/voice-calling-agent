/**
 * Client for the agent's FastAPI helper (token issuance + history).
 *
 * Env names are pinned by `shared/configuration/env-conventions.md`:
 *   NEXT_PUBLIC_AGENT_API_URL â€” base URL of the FastAPI, e.g. http://localhost:8080
 *   NEXT_PUBLIC_LIVEKIT_URL   â€” LiveKit server URL the browser connects to
 *   NEXT_PUBLIC_AGENT_NAME    â€” display name for the agent participant
 */

export const LIVEKIT_URL: string | undefined = process.env.NEXT_PUBLIC_LIVEKIT_URL;
export const AGENT_API_URL: string | undefined = process.env.NEXT_PUBLIC_AGENT_API_URL;
export const AGENT_NAME: string = process.env.NEXT_PUBLIC_AGENT_NAME ?? "Voice Agent";

/** Response of the agent's `POST /token`. */
export interface TokenResponse {
  token: string;
  url: string;
  identity: string;
}

/** One message inside `GET /history/{sessionId}`. */
export interface HistoryMessage {
  role: "user" | "assistant" | "tool";
  content?: string;
  text?: string;
  createdAt?: string;
  timestamp?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

/** Lenient shape of `GET /history/{sessionId}`. */
export interface HistoryResponse {
  sessionId?: string;
  messages: HistoryMessage[];
}

export class AgentApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AgentApiError(
      `Missing ${name}. Copy .env.example to .env and set it (see shared/configuration/env-conventions.md).`,
    );
  }
  return value;
}

/**
 * Request a short-lived LiveKit token for `roomName`.
 *
 * POST {AGENT_API_URL}/token   body: { roomName }
 * ->    { token, url, identity }
 */
export async function getToken(roomName: string): Promise<TokenResponse> {
  const base = requireEnv("NEXT_PUBLIC_AGENT_API_URL");
  const livekitUrl = requireEnv("NEXT_PUBLIC_LIVEKIT_URL");

  let res: Response;
  try {
    res = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new AgentApiError(
      `Could not reach agent API at ${base} (is the agent running?): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!res.ok) {
    throw new AgentApiError(
      `Token request failed: HTTP ${res.status} ${await safeErrorText(res)}`,
      res.status,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AgentApiError("Token request returned non-JSON response.");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { token?: unknown }).token !== "string" ||
    typeof (body as { url?: unknown }).url !== "string" ||
    typeof (body as { identity?: unknown }).identity !== "string"
  ) {
    throw new AgentApiError("Token response missing token/url/identity fields.");
  }

  // The agent echoes the LiveKit URL it was configured with; prefer the
  // browser env var when they disagree, but fall back to the response.
  const url = (body as { url: string }).url ?? livekitUrl;
  return {
    token: (body as { token: string }).token,
    url,
    identity: (body as { identity: string }).identity,
  };
}

/**
 * Fetch the conversation history of a past (or current) session. Graceful:
 * returns `null` on any failure instead of throwing, so the UI can fall back
 * to last-known in-memory events without interrupting the call.
 */
export async function getHistory(sessionId: string): Promise<HistoryResponse | null> {
  const base = process.env.NEXT_PUBLIC_AGENT_API_URL;
  if (!base || !sessionId) return null;

  let res: Response;
  try {
    res = await fetch(`${base}/history/${encodeURIComponent(sessionId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  if (!isHistoryResponse(body)) return null;
  return body;
}

function isHistoryResponse(value: unknown): value is HistoryResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.messages)) return false;

  for (const message of record.messages) {
    if (typeof message !== "object" || message === null) return false;
    const m = message as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "tool") return false;
    if (m.content !== undefined && typeof m.content !== "string") return false;
    if (m.text !== undefined && typeof m.text !== "string") return false;
    if (m.createdAt !== undefined && typeof m.createdAt !== "string") return false;
    if (m.timestamp !== undefined && typeof m.timestamp !== "string") return false;
  }
  return true;
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 200);
    return text ? `â€” ${text}` : "";
  } catch {
    return "";
  }
}
