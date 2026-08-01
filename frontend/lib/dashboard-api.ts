/**
 * Typed REST client for the dashboard endpoints served by the agent's
 * FastAPI helper (same base as `lib/agent-api.ts`).
 *
 *   GET /dashboard/overview
 *   GET /dashboard/conversations
 *   GET /dashboard/conversations/{id}
 *   GET /dashboard/appointments
 *   GET /dashboard/orders
 *   GET /dashboard/customers
 *   GET /dashboard/analytics
 *   GET /dashboard/system
 *   GET /dashboard/stats
 *
 * All fetches are graceful: failures resolve to `null` so pages can render
 * skeletons / empty states instead of crashing (mirrors `getHistory`).
 */

import { AGENT_API_URL } from "./agent-api";

// ---------------------------------------------------------------------------
// Types (shapes are the dashboard contract; the backend is built against them)
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  date: string;
  count: number;
}

export interface OverviewData {
  activeConversations: number;
  callsToday: number;
  appointmentsToday: number;
  ordersToday: number;
  revenueToday: number;
  avgCallDuration: number; // seconds
  aiSuccessRate: number; // 0..100
  failedToolCalls: number;
  series: {
    calls: SeriesPoint[];
    appointments: SeriesPoint[];
    orders: SeriesPoint[];
  };
}

export interface ToolCallRef {
  tool: string;
  args: unknown;
  ok: boolean;
  durationMs: number;
  ts: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  ts: string;
}

/** One row of the history table (list shape). */
export interface HistoryEntry {
  id: string;
  startedAt: string;
  customerName?: string;
  durationSec: number;
  messageCount: number;
  summary: string;
  outcome: string;
  toolsUsed: string[];
}

/** Full record behind `GET /dashboard/conversations/{id}`. */
export interface ConversationDetail {
  id: string;
  startedAt: string;
  customerName?: string | null;
  messages: ConversationMessage[];
  toolExecutions: ToolCallRef[];
  outcome: string;
  summary: string;
  durationSec: number;
}

export type AppointmentStatus = "confirmed" | "pending" | "cancelled" | string;

export interface Appointment {
  id: string;
  bookingId: string;
  customer: string;
  session: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  createdAt: string;
}

export interface OrderItem {
  name: string;
  quantity: number;
}

export type OrderStatus = "paid" | "pending" | "cancelled" | "refunded" | string;

export interface Order {
  id: string;
  orderId: string;
  customer: string;
  items: OrderItem[];
  status: OrderStatus;
  total: number;
  createdAt: string;
}

export interface BookingRef {
  session: string;
  date: string;
  time: string;
}

export interface Customer {
  id: string;
  name: string;
  tier: string;
  membershipStatus: string;
  visits: number;
  lastVisit: string;
  ltv: number;
  upcomingBooking: BookingRef | null;
}

export interface AnalyticsData {
  callsPerDay: SeriesPoint[];
  appointments: SeriesPoint[];
  orders: SeriesPoint[];
  toolUsage: { tool: string; count: number }[];
  durations: { date: string; avgDurationSec: number }[];
  satisfaction: number; // 0..100
  peakHours: { hour: number; count: number }[];
}

export type ServiceName = "livekit" | "ollama" | "whisper" | "deepgram" | "tts" | "n8n";
export type ServiceHealth = "ok" | "degraded" | "down";

export interface SystemStatusData {
  services: Partial<Record<ServiceName, ServiceHealth>>;
  updatedAt: string;
}

export const SERVICE_LABELS: Record<ServiceName, string> = {
  livekit: "LiveKit",
  ollama: "Ollama",
  whisper: "Whisper",
  deepgram: "Deepgram",
  tts: "TTS · Kokoro",
  n8n: "n8n",
};

// ---------------------------------------------------------------------------
// Statistics (`GET /dashboard/stats`) — the aggregate "Statistics" page
// ---------------------------------------------------------------------------

export interface TierCount {
  tier: string;
  count: number;
}

export interface ServiceCount {
  service: string;
  count: number;
}

export interface OrderStatusCount {
  status: string;
  count: number;
}

export interface LowStockItem {
  name: string;
  stock: number;
}

export interface ToolStat {
  tool: string;
  count: number;
  ok: number;
}

export interface PeakHour {
  hour: number;
  count: number;
}

export interface StatsData {
  members: {
    total: number;
    byTier: TierCount[];
    expiringSoon30: number;
    expiringSoon7: number;
    totalVisits: number;
  };
  bookings: {
    upcoming: number;
    today: number;
    spa: number;
    gym: number;
    byService: ServiceCount[];
  };
  orders: {
    total: number;
    revenue: number;
    avgValue: number;
    byStatus: OrderStatusCount[];
  };
  inventory: {
    products: number;
    lowStock: LowStockItem[];
    outOfStock: number;
  };
  conversations: {
    total: number;
    ok: number;
    failed: number;
    avgDurationSec: number;
    totalMessages: number;
  };
  tools: {
    executions: number;
    successRate: number; // 0..100
    avgLatencyMs: number;
    byTool: ToolStat[];
  };
  revenue: {
    today: number;
    week: number;
    month: number;
  };
  peakHours: PeakHour[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class DashboardApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
  }
}

function apiBase(): string {
  if (!AGENT_API_URL) {
    throw new DashboardApiError(
      "Missing NEXT_PUBLIC_AGENT_API_URL. Copy .env.example to .env.local and set it.",
    );
  }
  return AGENT_API_URL;
}

async function getJson<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface StaffRequest {
  requestId: string;
  member: string;
  requestType: string;
  details: string;
  status: string;
  createdAt: string;
}

export const dashboardApi = {
  overview: () => getJson<OverviewData>("/dashboard/overview"),
  conversations: () => getJson<HistoryEntry[]>("/dashboard/conversations"),
  conversation: (id: string) =>
    getJson<ConversationDetail>(`/dashboard/conversations/${encodeURIComponent(id)}`),
  appointments: () => getJson<Appointment[]>("/dashboard/appointments"),
  orders: () => getJson<Order[]>("/dashboard/orders"),
  customers: () => getJson<Customer[]>("/dashboard/customers"),
  analytics: () => getJson<AnalyticsData>("/dashboard/analytics"),
  system: () => getJson<SystemStatusData>("/dashboard/system"),
  stats: () => getJson<StatsData>("/dashboard/stats"),
  requests: () => getJson<StaffRequest[]>("/dashboard/requests"),
  completeRequest: async (requestId: string): Promise<StaffRequest | null> => {
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/dashboard/requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    try {
      return (await res.json()) as StaffRequest;
    } catch {
      return null;
    }
  },
};

export type DashboardResource = keyof typeof dashboardApi;
