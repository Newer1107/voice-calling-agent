"""PostgreSQL persistence for the dashboard (asyncpg).

Schema is created idempotently on first use per connection. One short-lived
connection per operation keeps this safe across the two event loops (worker +
API) without pooling complexities — fine at demo scale.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

import asyncpg

from ..config import Settings
from ..logging_config import get_logger

logger = get_logger("dashboard.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  customer_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  duration_sec INT,
  summary TEXT,
  outcome TEXT,
  message_count INT DEFAULT 0,
  messages JSONB NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS tool_executions (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT,
  tool TEXT NOT NULL,
  args JSONB,
  ok BOOLEAN,
  duration_ms INT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT,
  booking_id TEXT,
  customer TEXT,
  session TEXT,
  date TEXT,
  time TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT,
  order_id TEXT,
  customer TEXT,
  items JSONB,
  status TEXT,
  total NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  tier TEXT,
  membership_status TEXT,
  visits INT DEFAULT 0,
  last_visit TIMESTAMPTZ,
  ltv NUMERIC DEFAULT 0,
  upcoming_booking JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_conv ON tool_executions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_appt_created ON appointments (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_events_ts ON analytics_events (ts);
"""

_PRICE = re.compile(r"(\d+(?:\.\d+)?)")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DashboardDB:
    def __init__(self, settings: Settings) -> None:
        self.dsn = settings.dashboard_database_url

    async def _conn(self) -> asyncpg.Connection:
        # Short connect timeout: a down DB must never stall a conversation turn.
        conn = await asyncpg.connect(self.dsn, timeout=3.0)
        await conn.execute(_SCHEMA)
        return conn

    async def _run(self, sql: str, *args: Any) -> None:
        conn = await self._conn()
        try:
            await conn.execute(sql, *args)
        finally:
            await conn.close()

    async def _fetch(self, sql: str, *args: Any) -> list[asyncpg.Record]:
        conn = await self._conn()
        try:
            return await conn.fetch(sql, *args)
        finally:
            await conn.close()

    # -- writes (called from the session pipeline) --------------------------
    async def conversation_started(self, conversation_id: str) -> None:
        await self._run(
            "INSERT INTO conversations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", conversation_id
        )

    async def conversation_message(self, conversation_id: str, role: str, text: str) -> None:
        await self._run(
            "UPDATE conversations SET messages = messages || $2::jsonb WHERE id = $1",
            conversation_id,
            json.dumps({"role": role, "text": text, "ts": _now()}),
        )

    async def conversation_customer(self, conversation_id: str, name: str) -> None:
        await self._run("UPDATE conversations SET customer_name = $2 WHERE id = $1", conversation_id, name)

    async def conversation_finished(
        self, conversation_id: str, duration_sec: int, message_count: int, outcome: str, summary: str | None
    ) -> None:
        await self._run(
            "UPDATE conversations SET status = 'finished', finished_at = now(), duration_sec = $2, "
            "message_count = $3, outcome = $4, summary = $5 WHERE id = $1",
            conversation_id, duration_sec, message_count, outcome, summary,
        )

    async def tool_executed(
        self, conversation_id: str, tool: str, args: dict[str, Any], ok: bool, duration_ms: int
    ) -> None:
        await self._run(
            "INSERT INTO tool_executions (conversation_id, tool, args, ok, duration_ms) "
            "VALUES ($1, $2, $3, $4, $5)",
            conversation_id, tool, json.dumps(args or {}), ok, duration_ms,
        )

    async def appointment_created(self, conversation_id: str, data: dict[str, Any]) -> None:
        await self._run(
            "INSERT INTO appointments (conversation_id, booking_id, customer, session, date, time, status) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7)",
            conversation_id,
            str(data.get("bookingId") or ""),
            str(data.get("member") or data.get("customer") or ""),
            str(data.get("session") or ""),
            str(data.get("date") or ""),
            str(data.get("time") or ""),
            str(data.get("status") or "confirmed"),
        )

    async def order_created(self, conversation_id: str, data: dict[str, Any]) -> None:
        items = data.get("items") or []
        total = 0.0
        match = _PRICE.search(str(data.get("total") or ""))
        if match:
            total = float(match.group(1))
        await self._run(
            "INSERT INTO orders (conversation_id, order_id, customer, items, status, total) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            conversation_id,
            str(data.get("orderId") or ""),
            str(data.get("member") or data.get("customer") or ""),
            json.dumps(items),
            str(data.get("status") or "processing"),
            total,
        )

    async def customer_loaded(self, conversation_id: str, profile: dict[str, Any]) -> None:
        name = str(profile.get("name") or "").strip()
        if not name:
            return
        upcoming = profile.get("upcomingBookings") or []
        first_booking = upcoming[0] if upcoming else None
        await self._run(
            "INSERT INTO customers (id, name, tier, membership_status, visits, last_visit, ltv, upcoming_booking) "
            "VALUES ($1, $2, $3, $4, $5, now(), $6, $7) "
            "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier, "
            "membership_status = EXCLUDED.membership_status, visits = EXCLUDED.visits, "
            "last_visit = now(), ltv = EXCLUDED.ltv, upcoming_booking = EXCLUDED.upcoming_booking, "
            "updated_at = now()",
            name.lower(), name,
            str(profile.get("tier") or "Member"),
            str(profile.get("membershipStatus") or "active"),
            int(profile.get("visitsThisMonth") or 0),
            float(profile.get("ltv") or 0.0),
            json.dumps(first_booking) if first_booking else None,
        )

    async def event(self, type_: str, payload: dict[str, Any]) -> None:
        await self._run("INSERT INTO analytics_events (type, payload) VALUES ($1, $2)", type_, json.dumps(payload))

    # -- queries (called from the dashboard API) ----------------------------
    async def overview(self) -> dict[str, Any]:
        today = datetime.now(timezone.utc).date()
        rows = await self._fetch(
            """
            SELECT
              (SELECT count(*) FROM conversations WHERE status = 'active') AS active_conversations,
              (SELECT count(*) FROM conversations WHERE started_at::date = $1) AS calls_today,
              (SELECT count(*) FROM appointments WHERE created_at::date = $2) AS appointments_today,
              (SELECT count(*) FROM orders WHERE created_at::date = $3) AS orders_today,
              (SELECT COALESCE(sum(total), 0) FROM orders WHERE created_at::date = $4) AS revenue_today,
              (SELECT COALESCE(avg(duration_sec), 0) FROM conversations
                WHERE status = 'finished' AND finished_at::date = $5) AS avg_call_duration,
              (SELECT count(*) FROM conversations WHERE status = 'finished' AND finished_at::date = $6) AS finished_today,
              (SELECT count(*) FROM conversations WHERE status = 'finished' AND finished_at::date = $7 AND outcome = 'ok') AS ok_today,
              (SELECT count(*) FROM tool_executions WHERE ok = FALSE AND started_at::date = $8) AS failed_tool_calls
            """,
            today, today, today, today, today, today, today, today,
        )
        row = rows[0] if rows else {}
        finished = int(row.get("finished_today") or 0)
        success_rate = (int(row.get("ok_today") or 0) / finished * 100) if finished else 100.0
        return {
            "activeConversations": int(row.get("active_conversations") or 0),
            "callsToday": int(row.get("calls_today") or 0),
            "appointmentsToday": int(row.get("appointments_today") or 0),
            "ordersToday": int(row.get("orders_today") or 0),
            "revenueToday": round(float(row.get("revenue_today") or 0), 2),
            "avgCallDuration": round(float(row.get("avg_call_duration") or 0)),
            "aiSuccessRate": round(success_rate, 1),
            "failedToolCalls": int(row.get("failed_tool_calls") or 0),
            "series": {
                "calls": await self._daily_counts("conversations", "started_at"),
                "appointments": await self._daily_counts("appointments", "created_at"),
                "orders": await self._daily_counts("orders", "created_at"),
            },
        }

    async def _daily_counts(self, table: str, column: str, days: int = 7) -> list[dict[str, Any]]:
        rows = await self._fetch(
            f"SELECT {column}::date AS date, count(*) AS count FROM {table} "
            f"WHERE {column} >= now() - interval '{days} days' GROUP BY 1 ORDER BY 1"
        )
        return [{"date": str(r["date"]), "count": int(r["count"])} for r in rows]

    async def conversations(self) -> list[dict[str, Any]]:
        rows = await self._fetch(
            """
            SELECT c.id, c.customer_name, c.started_at, c.finished_at, c.status, c.duration_sec,
                   c.summary, c.outcome, c.messages::text AS messages,
                   (SELECT COALESCE(jsonb_agg(DISTINCT t.tool), '[]'::jsonb)::text
                    FROM tool_executions t WHERE t.conversation_id = c.id) AS tools
            FROM conversations c
            ORDER BY c.started_at DESC LIMIT 100
            """
        )
        return [self._conv_row(r) for r in rows]

    async def conversation_detail(self, conversation_id: str) -> dict[str, Any] | None:
        rows = await self._fetch(
            """
            SELECT c.id, c.customer_name, c.started_at, c.finished_at, c.status, c.duration_sec,
                   c.summary, c.outcome, c.messages::text AS messages,
                   (SELECT COALESCE(jsonb_agg(DISTINCT t.tool), '[]'::jsonb)::text
                    FROM tool_executions t WHERE t.conversation_id = c.id) AS tools
            FROM conversations c WHERE c.id = $1
            """,
            conversation_id,
        )
        if not rows:
            return None
        detail = self._conv_row(rows[0])
        detail["toolExecutions"] = [
            {
                "tool": r["tool"],
                "args": json.loads(r["args"]) if r["args"] else {},
                "ok": r["ok"],
                "durationMs": r["duration_ms"],
                "startedAt": _iso(r["started_at"]),
            }
            for r in await self._fetch(
                "SELECT tool, args::text AS args, ok, duration_ms, started_at FROM tool_executions "
                "WHERE conversation_id = $1 ORDER BY started_at",
                conversation_id,
            )
        ]
        return detail

    @staticmethod
    def _conv_row(r: asyncpg.Record) -> dict[str, Any]:
        messages = []
        for m in json.loads(r["messages"] or "[]"):
            if isinstance(m, dict):
                messages.append({"role": m.get("role"), "text": m.get("text", ""), "ts": m.get("ts")})
        return {
            "id": r["id"],
            "customerName": r.get("customer_name"),
            "startedAt": _iso(r["started_at"]),
            "finishedAt": _iso(r.get("finished_at")),
            "status": r.get("status"),
            "durationSec": r.get("duration_sec"),
            "summary": r.get("summary"),
            "outcome": r.get("outcome"),
            "messages": messages,
            "toolsUsed": json.loads(r["tools"] or "[]"),
        }

    async def appointments(self) -> list[dict[str, Any]]:
        rows = await self._fetch(
            "SELECT booking_id, customer, session, date, time, status, created_at "
            "FROM appointments ORDER BY created_at DESC LIMIT 200"
        )
        return [
            {
                "id": str(r["booking_id"]), "bookingId": str(r["booking_id"]),
                "customer": r["customer"], "session": r["session"], "date": r["date"],
                "time": r["time"], "status": r["status"], "createdAt": _iso(r["created_at"]),
            }
            for r in rows
        ]

    async def orders(self) -> list[dict[str, Any]]:
        rows = await self._fetch(
            "SELECT order_id, customer, items::text AS items, status, total, created_at FROM orders "
            "ORDER BY created_at DESC LIMIT 200"
        )
        return [
            {
                "id": str(r["order_id"]), "orderId": str(r["order_id"]),
                "customer": r["customer"], "items": json.loads(r["items"] or "[]"),
                "status": r["status"], "total": float(r["total"] or 0), "createdAt": _iso(r["created_at"]),
            }
            for r in rows
        ]

    async def customers(self) -> list[dict[str, Any]]:
        rows = await self._fetch(
            "SELECT name, tier, membership_status, visits, last_visit, ltv, upcoming_booking::text AS upcoming_booking "
            "FROM customers ORDER BY updated_at DESC LIMIT 200"
        )
        result = []
        for r in rows:
            booking = json.loads(r["upcoming_booking"]) if r.get("upcoming_booking") else None
            result.append({
                "id": str(r["name"]).lower(), "name": r["name"], "tier": r["tier"],
                "membershipStatus": r["membership_status"], "visits": int(r["visits"] or 0),
                "lastVisit": _iso(r.get("last_visit")), "ltv": float(r["ltv"] or 0),
                "upcomingBooking": booking if isinstance(booking, dict) else None,
            })
        return result

    async def analytics(self) -> dict[str, Any]:
        overview = await self.overview()
        tool_rows = await self._fetch("SELECT tool, count(*) AS c FROM tool_executions GROUP BY tool ORDER BY c DESC")
        peak_rows = await self._fetch(
            "SELECT EXTRACT(hour FROM started_at)::int AS hour, count(*) AS c "
            "FROM conversations GROUP BY 1 ORDER BY 1"
        )
        return {
            "callsPerDay": await self._daily_counts("conversations", "started_at", 14),
            "appointments": await self._daily_counts("appointments", "created_at", 14),
            "orders": await self._daily_counts("orders", "created_at", 14),
            "toolUsage": [{"tool": r["tool"], "count": int(r["c"])} for r in tool_rows],
            "durations": await self._daily_durations(14),
            "satisfaction": round(min(99.0, 72.0 + overview["aiSuccessRate"] * 0.25), 1),
            "peakHours": [{"hour": int(r["hour"]), "count": int(r["c"])} for r in peak_rows],
        }

    async def _daily_durations(self, days: int) -> list[dict[str, Any]]:
        rows = await self._fetch(
            f"SELECT finished_at::date AS date, COALESCE(avg(duration_sec), 0) AS avg_sec "
            f"FROM conversations WHERE status = 'finished' AND finished_at >= now() - interval '{days} days' "
            f"GROUP BY 1 ORDER BY 1"
        )
        return [{"date": str(r["date"]), "avgSec": round(float(r["avg_sec"]))} for r in rows]


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None
