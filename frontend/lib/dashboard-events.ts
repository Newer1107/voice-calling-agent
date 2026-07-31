/**
 * WebSocket client for the dashboard realtime feed.
 *
 * Connect to `${AGENT_API_URL replaced http->ws}/ws/dashboard`. Inbound
 * frames are JSON `{ type, ts, data }` — see `DashboardEvent` below (the
 * dashboard contract; the backend is built against it).
 *
 * The store owns the single connection + reconnect policy; this module only
 * opens the socket, parses frames, and reports status/lifecycle through
 * callbacks.
 */

import { AGENT_API_URL } from "./agent-api";
import type { ServiceName, ServiceHealth } from "./dashboard-api";

// ---------------------------------------------------------------------------
// Event contract
// ---------------------------------------------------------------------------

export interface UpcomingBookingRef {
  session: string;
  date: string;
  time: string;
}

export interface CustomerRef {
  name: string;
  tier: string;
  membershipStatus: string;
  visitsThisMonth: number;
  upcomingBookings: (UpcomingBookingRef | null)[];
}

export type DashboardEvent =
  | {
      type: "conversation.started";
      ts: string;
      data: { conversationId: string; customerName?: string; startedAt: string };
    }
  | {
      type: "transcript.updated";
      ts: string;
      data: { conversationId: string; role: "user" | "assistant"; text: string; ts: string };
    }
  | {
      type: "customer.loaded";
      ts: string;
      data: { conversationId: string; customer: CustomerRef };
    }
  | {
      type: "tool.started";
      ts: string;
      data: { conversationId: string; tool: string; args: unknown; ts: string };
    }
  | {
      type: "tool.finished";
      ts: string;
      data: { conversationId: string; tool: string; ok: boolean; durationMs: number };
    }
  | {
      type: "appointment.created";
      ts: string;
      data: {
        conversationId: string;
        bookingId: string;
        customer: string;
        session: string;
        date: string;
        time: string;
        status: string;
      };
    }
  | {
      type: "order.created";
      ts: string;
      data: {
        conversationId: string;
        orderId: string;
        customer: string;
        items: { name: string; quantity: number }[];
        status: string;
        total: number;
      };
    }
  | {
      type: "conversation.finished";
      ts: string;
      data: { conversationId: string; durationSec: number; messageCount: number; outcome: string };
    }
  | {
      type: "system.status";
      ts: string;
      data: { services: Partial<Record<ServiceName, ServiceHealth>>; updatedAt: string };
    };

export type DashboardEventType = DashboardEvent["type"];

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

export type DashboardWsStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface DashboardWsCallbacks {
  onEvent: (event: DashboardEvent) => void;
  onStatus: (status: DashboardWsStatus) => void;
}

export function dashboardWsUrl(): string | null {
  if (!AGENT_API_URL) return null;
  return `${AGENT_API_URL.replace(/^http/i, "ws")}/ws/dashboard`;
}

function parseFrame(raw: string): DashboardEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.type !== "string" || typeof frame.ts !== "string") return null;
  return frame as unknown as DashboardEvent;
}

/**
 * Open a dashboard WebSocket. Returns the socket, or `null` when no base URL
 * is configured. Reconnect policy lives in the store (see dashboard-store.tsx)
 * — this function is a plain factory.
 */
export function openDashboardSocket(callbacks: DashboardWsCallbacks): WebSocket | null {
  const url = dashboardWsUrl();
  if (!url) return null;

  const socket = new WebSocket(url);
  socket.onopen = () => callbacks.onStatus("open");
  socket.onmessage = (message) => {
    const event = typeof message.data === "string" ? parseFrame(message.data) : null;
    if (event) callbacks.onEvent(event);
  };
  // The store observes close/error and schedules the next attempt; report the
  // transition here so the UI pill reflects it immediately.
  socket.onclose = () => callbacks.onStatus("reconnecting");
  socket.onerror = () => {
    /* onclose follows; the store owns reconnect scheduling */
  };
  return socket;
}
