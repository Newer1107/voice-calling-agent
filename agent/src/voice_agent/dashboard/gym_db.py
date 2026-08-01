"""Gym business database: schema + seed + CRUD for the agent's tools.

Lives in the same PostgreSQL as the dashboard (voice_dashboard database) but
in its own tables. This is the "full gym mockup": members, memberships,
classes, spa services, bookings, products and orders — seeded with realistic
data and read/written LIVE by the agent's tools.
"""

from __future__ import annotations

import json
import random
from datetime import date, datetime, timezone, timedelta
from typing import Any

import asyncpg

from ..config import Settings
from ..logging_config import get_logger

logger = get_logger("gym.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  email TEXT,
  phone TEXT,
  joined_on DATE
);
CREATE TABLE IF NOT EXISTS memberships (
  member_id INT PRIMARY KEY REFERENCES members(id),
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_on DATE NOT NULL,
  visits_this_month INT DEFAULT 0,
  ltv NUMERIC DEFAULT 0,
  auto_renew BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS gym_classes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  duration_min INT,
  instructor TEXT
);
CREATE TABLE IF NOT EXISTS spa_services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  duration_min INT,
  price NUMERIC,
  therapist TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  booking_id TEXT UNIQUE,
  member_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  service TEXT NOT NULL,
  date TEXT,
  time TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  category TEXT
);
CREATE TABLE IF NOT EXISTS gym_orders (
  id SERIAL PRIMARY KEY,
  order_id TEXT UNIQUE,
  member_name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'processing',
  total NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
"""

TIER_PRICES = {"Silver": "39.00 GBP", "Gold": "59.00 GBP", "Platinum": "99.00 GBP"}

_gym_ready = False


def _days_from_today(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


async def ensure_gym(conn: asyncpg.Connection) -> None:
    """Create the gym schema and seed it once per process.

    Called from both the gym tool backend and the dashboard API, so the
    seeded dataset is present the moment either touches the database.
    """
    global _gym_ready
    await conn.execute(_SCHEMA)
    if _gym_ready:
        return
    await _seed(conn)
    _gym_ready = True


async def _seed(conn: asyncpg.Connection) -> None:
    # Deterministic mockup: reset the gym data to the seeded state on every
    # process start (module `_gym_ready` guard prevents re-seeding).
    await conn.execute(
        "TRUNCATE members, memberships, gym_classes, spa_services, bookings, products, gym_orders "
        "RESTART IDENTITY CASCADE"
    )
    members = [
        ("Sarah", "sarah@gym.example", "555-0101", _days_from_today(-540), "Silver", "active", 31, 15, 620.0),
        ("Ravi", "ravi@gym.example", "555-0102", _days_from_today(-300), "Silver", "active", 3, 8, 310.0),
        ("Alice", "alice@gym.example", "555-0103", _days_from_today(-720), "Gold", "active", 25, 22, 1450.0),
        ("Priya", "priya@gym.example", "555-0104", _days_from_today(-900), "Platinum", "active", 60, 30, 3200.0),
        ("Vikram", "vikram@gym.example", "555-0105", _days_from_today(-200), "Silver", "active", 40, 5, 180.0),
        ("Ananya", "ananya@gym.example", "555-0106", _days_from_today(-650), "Gold", "active", 12, 18, 1100.0),
        ("Rahul", "rahul@gym.example", "555-0107", _days_from_today(-1000), "Platinum", "active", 90, 25, 4100.0),
        ("Meera", "meera@gym.example", "555-0108", _days_from_today(-380), "Silver", "active", 45, 10, 420.0),
    ]
    for name, email, phone, joined, tier, status, days, visits, ltv in members:
        await conn.execute(
            "INSERT INTO members (name, email, phone, joined_on) VALUES ($1,$2,$3,$4) "
            "ON CONFLICT (name) DO NOTHING",
            name, email, phone, date.fromisoformat(joined),
        )
        member_id = await conn.fetchval("SELECT id FROM members WHERE name = $1", name)
        await conn.execute(
            "INSERT INTO memberships (member_id, tier, status, expires_on, visits_this_month, ltv) "
            "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (member_id) DO NOTHING",
            member_id, tier, status, date.fromisoformat(_days_from_today(days)), visits, ltv,
        )
    for name, category, dur, instructor in [
        ("Yoga Basics", "Yoga", 60, "Aisha"),
        ("HIIT Burn", "Cardio", 45, "Arjun"),
        ("Spin Class", "Cardio", 45, "Kabir"),
        ("CrossFit", "Strength", 60, "Dev"),
        ("Personal Training", "Strength", 60, "Arjun"),
    ]:
        await conn.execute(
            "INSERT INTO gym_classes (name, category, duration_min, instructor) VALUES ($1,$2,$3,$4)",
            name, category, dur, instructor,
        )
    for name, dur, price, therapist in [
        ("Swedish Massage", 60, 79.0, "Aisha"),
        ("Deep Tissue Massage", 60, 89.0, "Aisha"),
        ("Sauna Session", 30, 25.0, None),
        ("Aromatherapy Facial", 45, 69.0, "Nisha"),
        ("Hot Stone Therapy", 75, 99.0, "Nisha"),
    ]:
        await conn.execute(
            "INSERT INTO spa_services (name, duration_min, price, therapist) VALUES ($1,$2,$3,$4)",
            name, dur, price, therapist,
        )
    for name, price, stock, category in [
        ("Protein Shake", 5.5, 120, "Nutrition"),
        ("Resistance Band", 12.99, 80, "Equipment"),
        ("Gym Tee", 24.99, 50, "Apparel"),
        ("Kettlebell 16kg", 49.99, 10, "Equipment"),
        ("Yoga Mat", 19.99, 30, "Equipment"),
    ]:
        await conn.execute(
            "INSERT INTO products (name, price, stock, category) VALUES ($1,$2,$3,$4)",
            name, price, stock, category,
        )
    await conn.execute(
        "INSERT INTO bookings (booking_id, member_name, kind, service, date, time, status) VALUES "
        "('SPA-1001', 'Sarah', 'spa', 'Swedish Massage', $1, '16:00', 'confirmed'), "
        "('GYM-1002', 'Sarah', 'gym', 'Personal Training', $2, '18:00', 'confirmed'), "
        "('SPA-1003', 'Alice', 'spa', 'Sauna Session', $3, '09:00', 'confirmed'), "
        "('GYM-1004', 'Ravi', 'gym', 'CrossFit', $4, '07:00', 'confirmed')",
        _days_from_today(1), _days_from_today(2), _days_from_today(1), _days_from_today(1),
    )
    await conn.execute(
        "INSERT INTO gym_orders (order_id, member_name, items, status, total) VALUES "
        "('ORD-1001', 'Rahul', '[{\"name\":\"Protein Shake\",\"quantity\":4}]', 'processing', 22.0), "
        "('ORD-1002', 'Priya', '[{\"name\":\"Gym Tee\",\"quantity\":2}]', 'delivered', 49.98)"
    )
    logger.info("gym database seeded", extra={"event": "gym.seeded"})


class GymDB:
    """Asyncpg-backed gym store; one short-lived connection per call."""

    def __init__(self, settings: Settings) -> None:
        self.dsn = settings.dashboard_database_url

    async def _conn(self) -> asyncpg.Connection:
        conn = await asyncpg.connect(self.dsn, timeout=3.0)
        await ensure_gym(conn)
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

    async def _fetchrow(self, sql: str, *args: Any) -> asyncpg.Record | None:
        conn = await self._conn()
        try:
            return await conn.fetchrow(sql, *args)
        finally:
            await conn.close()

    # -- member helpers ------------------------------------------------------
    async def _member(self, name: str) -> asyncpg.Record | None:
        return await self._fetchrow(
            """SELECT m.id, m.name, m.email, m.phone, m.joined_on,
                      ms.tier, ms.status, ms.expires_on, ms.visits_this_month, ms.ltv
               FROM members m JOIN memberships ms ON ms.member_id = m.id
               WHERE lower(m.name) = lower($1)""",
            name.strip(),
        )

    async def _upcoming_bookings(self, member_name: str) -> list[dict[str, Any]]:
        rows = await self._fetch(
            "SELECT kind, service, date, time, therapist FROM bookings b "
            "LEFT JOIN spa_services s ON s.name = b.service "
            "WHERE lower(member_name) = lower($1) AND status = 'confirmed' "
            "AND date >= $2 ORDER BY date, time LIMIT 6",
            member_name, date.today().isoformat(),
        )
        result = []
        for r in rows:
            b: dict[str, Any] = {"type": r["kind"], "session": r["service"], "date": r["date"], "time": r["time"]}
            if r["kind"] == "spa" and r.get("therapist"):
                b["therapist"] = r["therapist"]
            result.append(b)
        return result

    # -- tool operations (each returns the webhook-shaped data payload) ------
    async def lookup_customer(self, args: dict[str, Any]) -> dict[str, Any]:
        member = await self._member(str(args.get("name") or args.get("email") or ""))
        if member is None:
            raise ValueError("No customer found")
        return {
            "memberId": f"M-{member['id'] + 100}",
            "name": member["name"],
            "tier": member["tier"],
            "membershipStatus": member["status"],
            "joinedOn": str(member["joined_on"]),
            "expiresOn": str(member["expires_on"]),
            "daysRemaining": max(0, (member["expires_on"] - date.today()).days),
            "renewalPrice": TIER_PRICES.get(member["tier"], "39.00 GBP"),
            "visitsThisMonth": int(member["visits_this_month"]),
            "ltv": float(member["ltv"]),
            "upcomingBookings": await self._upcoming_bookings(member["name"]),
        }

    async def get_membership(self, args: dict[str, Any]) -> dict[str, Any]:
        member = await self._member(str(args.get("name") or args.get("email") or ""))
        if member is None:
            raise ValueError("No customer found")
        return {
            "name": member["name"],
            "tier": member["tier"],
            "membershipStatus": member["status"],
            "joinedOn": str(member["joined_on"]),
            "expiresOn": str(member["expires_on"]),
            "daysRemaining": max(0, (member["expires_on"] - date.today()).days),
            "renewalPrice": TIER_PRICES.get(member["tier"], "39.00 GBP"),
            "autoRenew": False,
        }

    async def book_appointment(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("customerName") or "")
        session = str(args.get("session") or "Group Fitness")
        day = str(args.get("date") or date.today().isoformat())
        time_ = str(args.get("time") or "18:00")
        booking_id = f"GYM-{random.randint(1000, 9999)}"
        await self._run(
            "INSERT INTO bookings (booking_id, member_name, kind, service, date, time, status) "
            "VALUES ($1,$2,'gym',$3,$4,$5,'confirmed')",
            booking_id, name, session, day, time_,
        )
        return {"bookingId": booking_id, "session": session, "date": day, "time": time_, "member": name, "status": "confirmed"}

    async def book_spa(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("customerName") or "")
        service = str(args.get("service") or "Swedish Massage")
        day = str(args.get("date") or date.today().isoformat())
        time_ = str(args.get("time") or "16:00")
        row = await self._fetchrow(
            "SELECT duration_min, price, therapist FROM spa_services WHERE lower(name) = lower($1)", service
        )
        if row is None:
            raise ValueError(f"{service} is not available at the spa")
        booking_id = f"SPA-{random.randint(1000, 9999)}"
        await self._run(
            "INSERT INTO bookings (booking_id, member_name, kind, service, date, time, status) "
            "VALUES ($1,$2,'spa',$3,$4,$5,'confirmed')",
            booking_id, name, service, day, time_,
        )
        return {
            "bookingId": booking_id, "service": service,
            "durationMinutes": int(row["duration_min"]),
            "date": day, "time": time_, "member": name,
            "therapist": row["therapist"] or "available",
            "status": "confirmed", "price": f"{float(row['price']):.2f} GBP",
        }

    async def cancel_bookings(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("customerName") or "")
        conn = await self._conn()
        try:
            await conn.execute(
                "UPDATE bookings SET status = 'cancelled' WHERE lower(member_name) = lower($1) AND status = 'confirmed'",
                name,
            )
            count = await conn.fetchval(
                "SELECT count(*) FROM bookings WHERE lower(member_name) = lower($1) AND status = 'cancelled' AND "
                "created_at > now() - interval '10 minutes'", name
            )
        finally:
            await conn.close()
        return {"status": "cancelled", "refundEligible": True, "cancelled": int(count or 0)}

    async def upgrade_membership(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("customerName") or "")
        target = str(args.get("tier") or "Gold").capitalize()
        member = await self._member(name)
        if member is None:
            raise ValueError("No customer found")
        previous = member["tier"]
        await self._run(
            "UPDATE memberships SET tier = $1 WHERE member_id = $2", target, member["id"]
        )
        return {
            "memberId": f"M-{member['id'] + 100}", "name": member["name"], "tier": target,
            "previousTier": previous, "effectiveFrom": date.today().isoformat(),
            "status": "upgraded", "price": TIER_PRICES.get(target, "59.00 GBP"),
        }

    async def create_order(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("customerName") or "")
        items = args.get("items") or []
        total = 0.0
        rows = await self._fetch("SELECT name, price, stock FROM products")
        stock_map = {r["name"].lower(): r for r in rows}
        order_items = []
        for item in items:
            product_name = str(item.get("name") or "")
            qty = int(item.get("quantity") or 1)
            product = stock_map.get(product_name.lower())
            if product is None:
                raise ValueError(f"{product_name} is not in the shop")
            if int(product["stock"]) < qty:
                raise ValueError(f"{product_name} is out of stock")
            order_items.append({"name": product_name, "quantity": qty})
            total += float(product["price"]) * qty
        order_id = f"ORD-{random.randint(1000, 9999)}"
        conn = await self._conn()
        try:
            async with conn.transaction():
                for item in order_items:
                    await conn.execute(
                        "UPDATE products SET stock = stock - $1 WHERE lower(name) = lower($2)",
                        item["quantity"], item["name"],
                    )
                await conn.execute(
                    "INSERT INTO gym_orders (order_id, member_name, items, status, total) VALUES ($1,$2,$3,'processing',$4)",
                    order_id, name, json.dumps(order_items), total,
                )
        finally:
            await conn.close()
        return {"orderId": order_id, "member": name, "items": order_items, "total": f"{total:.2f} GBP", "status": "processing"}

    async def check_inventory(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("productName") or args.get("productId") or "")
        row = await self._fetchrow(
            "SELECT name, stock FROM products WHERE lower(name) = lower($1)", name
        )
        if row is None:
            raise ValueError(f"{name} not found")
        return {"item": row["name"], "available": int(row["stock"]), "inStock": int(row["stock"]) > 0, "location": "Gym Floor"}

    async def send_email(self, args: dict[str, Any]) -> dict[str, Any]:
        return {
            "messageId": f"MSG-{random.randint(1000, 9999)}",
            "to": str(args.get("to") or "member@gym.example"),
            "subject": str(args.get("subject") or "Your gym confirmation"),
            "status": "sent",
        }
