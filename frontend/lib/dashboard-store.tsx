"use client";

/**
 * Shared dashboard store: one WebSocket connection to the dashboard feed,
 * auto-reconnect with exponential backoff, and a reducer that pages consume
 * through `useDashboard()`. On every (re)connect the REST data is refetched
 * so the UI converges to the backend's truth.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  dashboardApi,
  type AnalyticsData,
  type Appointment,
  type ConversationDetail,
  type Customer,
  type HistoryEntry,
  type Order,
  type OverviewData,
  type SeriesPoint,
  type SystemStatusData,
} from "./dashboard-api";
import {
  openDashboardSocket,
  type CustomerRef,
  type DashboardEvent,
  type DashboardWsStatus,
} from "./dashboard-events";

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

export interface ActiveTool {
  tool: string;
  args: unknown;
  startedAt: string;
  ok?: boolean;
  durationMs?: number;
}

export interface ActiveConversation {
  id: string;
  customerName?: string;
  startedAt: string;
  messages: { role: "user" | "assistant"; text: string; ts: string }[];
  customer?: CustomerRef;
  /** The tool currently executing, if any. */
  currentTool: ActiveTool | null;
  /** Recently finished tools (for the card's tool trail). */
  tools: ActiveTool[];
}

export interface DashboardState {
  overview: OverviewData | null;
  history: HistoryEntry[] | null;
  appointments: Appointment[] | null;
  orders: Order[] | null;
  customers: Customer[] | null;
  analytics: AnalyticsData | null;
  system: SystemStatusData | null;
  /** Active (live) conversations, newest first. */
  active: ActiveConversation[];
}

const initialState: DashboardState = {
  overview: null,
  history: null,
  appointments: null,
  orders: null,
  customers: null,
  analytics: null,
  system: null,
  active: [],
};

export type DashboardResource =
  | "overview"
  | "conversations"
  | "appointments"
  | "orders"
  | "customers"
  | "analytics"
  | "system";

type Action =
  | { type: "SET_OVERVIEW"; data: OverviewData | null }
  | { type: "SET_HISTORY"; data: HistoryEntry[] | null }
  | { type: "SET_APPOINTMENTS"; data: Appointment[] | null }
  | { type: "SET_ORDERS"; data: Order[] | null }
  | { type: "SET_CUSTOMERS"; data: Customer[] | null }
  | { type: "SET_ANALYTICS"; data: AnalyticsData | null }
  | { type: "SET_SYSTEM"; data: SystemStatusData | null }
  | { type: "EVENT"; event: DashboardEvent };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bumpLast(series: SeriesPoint[]): SeriesPoint[] {
  if (series.length === 0) return series;
  const last = series[series.length - 1];
  return last ? [...series.slice(0, -1), { ...last, count: last.count + 1 }] : series;
}

/** Ensure a conversation exists (created on first observed message if the
 *  `conversation.started` event was missed). */
function upsertConversation(
  active: ActiveConversation[],
  id: string,
  startedAt: string,
): ActiveConversation[] {
  if (active.some((c) => c.id === id)) return active;
  return [{ id, startedAt, messages: [], currentTool: null, tools: [] }, ...active];
}

function updateConversation(
  state: DashboardState,
  id: string,
  update: (conversation: ActiveConversation) => ActiveConversation,
): DashboardState {
  return {
    ...state,
    active: state.active.map((c) => (c.id === id ? update(c) : c)),
  };
}

function applyEvent(state: DashboardState, event: DashboardEvent): DashboardState {
  switch (event.type) {
    case "conversation.started": {
      const { conversationId, customerName, startedAt } = event.data;
      return {
        ...state,
        active: [
          {
            id: conversationId,
            customerName,
            startedAt: startedAt || event.ts,
            messages: [],
            currentTool: null,
            tools: [],
          },
          ...state.active.filter((c) => c.id !== conversationId),
        ],
      };
    }

    case "transcript.updated": {
      const { conversationId, role, text, ts } = event.data;
      if (!text.trim()) return state;
      const next = upsertConversation(state.active, conversationId, event.ts);
      return {
        ...state,
        active: next.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: [...c.messages, { role, text, ts: ts || event.ts }],
              }
            : c,
        ),
      };
    }

    case "customer.loaded": {
      const { conversationId, customer } = event.data;
      const next = upsertConversation(state.active, conversationId, event.ts);
      return {
        ...state,
        active: next.map((c) =>
          c.id === conversationId ? { ...c, customer, customerName: customer.name } : c,
        ),
      };
    }

    case "tool.started": {
      const { conversationId, tool, args, ts } = event.data;
      const next = upsertConversation(state.active, conversationId, event.ts);
      return {
        ...state,
        active: next.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                currentTool: { tool, args, startedAt: ts || event.ts },
                tools: [...c.tools, { tool, args, startedAt: ts || event.ts }].slice(-5),
              }
            : c,
        ),
      };
    }

    case "tool.finished": {
      const { conversationId, tool, ok, durationMs } = event.data;
      return {
        ...state,
        active: state.active.map((c) => {
          if (c.id !== conversationId) return c;
          const finished: ActiveTool = {
            tool,
            args: c.currentTool?.args,
            startedAt: c.currentTool?.startedAt ?? event.ts,
            ok,
            durationMs,
          };
          return {
            ...c,
            currentTool: c.currentTool?.tool === tool ? null : c.currentTool,
            tools: c.tools.map((t) =>
              t.tool === tool && t.ok === undefined ? { ...t, ok, durationMs } : t,
            ).concat(
              c.currentTool?.tool === tool
                ? []
                : [finished],
            ).slice(-5),
          };
        }),
      };
    }

    case "appointment.created": {
      const { bookingId, customer, session, date, time, status } = event.data;
      const appointment: Appointment = {
        id: bookingId,
        bookingId,
        customer,
        session,
        date,
        time,
        status,
        createdAt: event.ts,
      };
      const overview = state.overview
        ? {
            ...state.overview,
            appointmentsToday: state.overview.appointmentsToday + 1,
            series: {
              ...state.overview.series,
              appointments: bumpLast(state.overview.series.appointments),
            },
          }
        : null;
      return {
        ...state,
        overview,
        appointments: state.appointments
          ? [appointment, ...state.appointments.filter((a) => a.bookingId !== bookingId)]
          : null,
      };
    }

    case "order.created": {
      const { orderId, customer, items, status, total } = event.data;
      const order: Order = { id: orderId, orderId, customer, items, status, total, createdAt: event.ts };
      const overview = state.overview
        ? {
            ...state.overview,
            ordersToday: state.overview.ordersToday + 1,
            revenueToday: state.overview.revenueToday + total,
            series: { ...state.overview.series, orders: bumpLast(state.overview.series.orders) },
          }
        : null;
      return {
        ...state,
        overview,
        orders: state.orders ? [order, ...state.orders.filter((o) => o.orderId !== orderId)] : null,
      };
    }

    case "conversation.finished": {
      const { conversationId } = event.data;
      return { ...state, active: state.active.filter((c) => c.id !== conversationId) };
    }

    case "system.status": {
      return {
        ...state,
        system: {
          services: event.data.services,
          updatedAt: event.data.updatedAt || event.ts,
        },
      };
    }

    default:
      // Unknown/unsupported event types (e.g. the initial "snapshot" frame)
      // must never clobber the state.
      return state;
  }
}

function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "SET_OVERVIEW":
      return { ...state, overview: action.data };
    case "SET_HISTORY":
      return { ...state, history: action.data };
    case "SET_APPOINTMENTS":
      return { ...state, appointments: action.data };
    case "SET_ORDERS":
      return { ...state, orders: action.data };
    case "SET_CUSTOMERS":
      return { ...state, customers: action.data };
    case "SET_ANALYTICS":
      return { ...state, analytics: action.data };
    case "SET_SYSTEM":
      return { ...state, system: action.data };
    case "EVENT":
      return applyEvent(state, action.event);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const MAX_BACKOFF_MS = 30_000;

interface DashboardContextValue {
  state: DashboardState;
  wsStatus: DashboardWsStatus;
  loading: boolean;
  refresh: (resource: DashboardResource) => void;
  refreshAll: () => void;
  /** Fetch one conversation detail (history drill-down). */
  fetchConversation: (id: string) => Promise<ConversationDetail | null>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function loadResource(dispatch: (action: Action) => void, resource: DashboardResource): void {
  switch (resource) {
    case "overview":
      void dashboardApi.overview().then((data) => dispatch({ type: "SET_OVERVIEW", data }));
      break;
    case "conversations":
      void dashboardApi.conversations().then((data) => dispatch({ type: "SET_HISTORY", data }));
      break;
    case "appointments":
      void dashboardApi.appointments().then((data) => dispatch({ type: "SET_APPOINTMENTS", data }));
      break;
    case "orders":
      void dashboardApi.orders().then((data) => dispatch({ type: "SET_ORDERS", data }));
      break;
    case "customers":
      void dashboardApi.customers().then((data) => dispatch({ type: "SET_CUSTOMERS", data }));
      break;
    case "analytics":
      void dashboardApi.analytics().then((data) => dispatch({ type: "SET_ANALYTICS", data }));
      break;
    case "system":
      void dashboardApi.system().then((data) => dispatch({ type: "SET_SYSTEM", data }));
      break;
  }
}

const ALL_RESOURCES: DashboardResource[] = [
  "overview",
  "conversations",
  "appointments",
  "orders",
  "customers",
  "analytics",
  "system",
];

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [wsStatus, setWsStatus] = useState<DashboardWsStatus>("closed");
  const [loading, setLoading] = useState(true);

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const refresh = useCallback((resource: DashboardResource) => {
    loadResource(dispatchRef.current, resource);
  }, []);

  const refreshAll = useCallback(() => {
    for (const resource of ALL_RESOURCES) loadResource(dispatchRef.current, resource);
  }, []);

  // First paint: pull everything once (skeletons until this settles).
  useEffect(() => {
    refreshAll();
    // The initial batch is 7 parallel requests; treat the first one to land
    // as "loaded enough" — the rest stream in silently.
    void dashboardApi.overview().then(() => setLoading(false));
  }, [refreshAll]);

  // Periodic system health refresh (the System page also has a manual button).
  useEffect(() => {
    const id = setInterval(() => {
      void dashboardApi.system().then((data) => dispatchRef.current({ type: "SET_SYSTEM", data }));
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;

  // Single WebSocket connection with backoff reconnect; refetch REST on open.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS);
      attempt += 1;
      setWsStatus("reconnecting");
      if (timer) clearTimeout(timer);
      timer = setTimeout(connect, delay);
    };

    const handleStatus = (status: DashboardWsStatus) => {
      if (status === "open") {
        attempt = 0;
        refreshAllRef.current(); // converge REST state after (re)connect
      }
      setWsStatus(status);
      if (status === "reconnecting") scheduleReconnect();
    };

    function connect() {
      if (cancelled) return;
      socket = openDashboardSocket({
        onStatus: handleStatus,
        onEvent: (event) => {
          dispatchRef.current({ type: "EVENT", event });
          if (event.type === "conversation.finished") {
            // Stats changed — pull fresh overview + history.
            loadResource(dispatchRef.current, "overview");
            loadResource(dispatchRef.current, "conversations");
          }
        },
      });
      if (!socket) setWsStatus("closed"); // no AGENT_API_URL configured
    }

    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      socket = null;
    };
  }, []);

  const fetchConversation = useCallback(
    (id: string) => dashboardApi.conversation(id),
    [],
  );

  const value = useMemo<DashboardContextValue>(
    () => ({ state, wsStatus, loading, refresh, refreshAll, fetchConversation }),
    [state, wsStatus, loading, refresh, refreshAll, fetchConversation],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within <DashboardProvider>");
  }
  return context;
}
