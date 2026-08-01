"""Gym business database: schema + seed + CRUD for the agent's tools.

Lives in the same PostgreSQL as the dashboard (voice_dashboard database) but
in its own tables. This is the "full gym mockup": members, memberships,
classes, spa services, bookings, products and orders — seeded with realistic
data and read/written LIVE by the agent's tools.
"""

from __future__ import annotations

import asyncio
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
  instructor TEXT,
  capacity INT DEFAULT 20
);
ALTER TABLE gym_classes ADD COLUMN IF NOT EXISTS capacity INT DEFAULT 20;
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
CREATE TABLE IF NOT EXISTS membership_plans (
  id SERIAL PRIMARY KEY,
  tier TEXT UNIQUE NOT NULL,
  price NUMERIC NOT NULL,
  perks TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_requests (
  id SERIAL PRIMARY KEY,
  request_id TEXT UNIQUE,
  member_name TEXT NOT NULL,
  request_type TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gym_kb (
  id SERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  keywords TEXT NOT NULL,
  answer TEXT NOT NULL
);
"""

TIER_PRICES = {"Silver": "39.00 GBP", "Gold": "59.00 GBP", "Platinum": "99.00 GBP"}

TIER_PERKS = {
    "Silver": "Gym access, group classes, and one guest pass per month.",
    "Gold": "Everything in Silver, plus spa access (sauna) and two personal training sessions per month.",
    "Platinum": "Everything in Gold, plus unlimited personal training, full spa, priority booking, locker and four guest passes.",
}

_gym_ready = False
# Serializes the one-time seed: the dashboard API and the tool backend can
# both open a connection on the same process start, and without a lock two
# concurrent seeds would TRUNCATE/insert over each other (duplicate key 500s,
# and a seed that fails mid-way leaves _gym_ready unset so every request
# retries it).
_seed_lock = asyncio.Lock()


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
    async with _seed_lock:
        if _gym_ready:
            return
        async with conn.transaction():
            await _seed(conn)
        _gym_ready = True


async def _seed(conn: asyncpg.Connection) -> None:
    # Deterministic mockup: reset the gym data to the seeded state on every
    # process start (module `_gym_ready` guard prevents re-seeding).
    await conn.execute(
        "TRUNCATE members, memberships, gym_classes, spa_services, bookings, products, gym_orders, "
        "membership_plans, staff_requests, gym_kb RESTART IDENTITY CASCADE"
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
            "INSERT INTO gym_classes (name, category, duration_min, instructor, capacity) VALUES ($1,$2,$3,$4,$5)",
            name, category, dur, instructor, 20,
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
        ("Personal Training 5-Pack", 100.0, 20, "Add-on"),
        ("Personal Training 10-Pack", 180.0, 15, "Add-on"),
        ("Guest Day Pass", 15.0, 100, "Add-on"),
        ("Locker Rental", 10.0, 50, "Add-on"),
        ("Nutrition Coaching", 30.0, 30, "Add-on"),
        ("Protein Shake Bundle", 12.5, 60, "Nutrition"),
        ("Gym Hoodie", 34.99, 25, "Apparel"),
    ]:
        await conn.execute(
            "INSERT INTO products (name, price, stock, category) VALUES ($1,$2,$3,$4)",
            name, price, stock, category,
        )
    for tier, price, perks in [
        ("Silver", 39.0, TIER_PERKS["Silver"]),
        ("Gold", 59.0, TIER_PERKS["Gold"]),
        ("Platinum", 99.0, TIER_PERKS["Platinum"]),
    ]:
        await conn.execute(
            "INSERT INTO membership_plans (tier, price, perks) VALUES ($1,$2,$3) ON CONFLICT (tier) DO NOTHING",
            tier, price, perks,
        )
    kb_rows = [
        ("hours", "hours open close time weekday weekend",
         "IronPeak Fitness is open Monday to Friday from 6 AM to 10 PM, Saturday from 7 AM to 9 PM, and Sunday from 8 AM to 8 PM."),
        ("location", "where address located location",
         "IronPeak Fitness is at 42 High Street, near the town centre, with free parking for members and a bike rack out front."),
        ("guest policy", "guest pass bring friend visitor day pass",
         "Members get one free guest pass per month with Silver, two with Gold and four with Platinum. Extra guest day passes are 15 GBP and can be bought over the phone."),
        ("freeze policy", "freeze pause hold membership vacation",
         "You can freeze your membership for up to 30 days per year at no charge. Request it and our front desk staff will set it up."),
        ("cancellation policy", "cancel cancel membership quit leave",
         "Memberships can be cancelled with 30 days notice; the request is handled by our front desk staff over the phone or in person."),
        ("dress code", "dress code wear clothes shoes towel",
         "Trainers and comfortable gym wear are required; a towel is needed for equipment. We sell towels, tees and gear at the front desk."),
        ("parking", "parking car bike park",
         "Members park free in our car park at the back of the building; there is also a covered bike rack."),
        ("personal training", "personal training pt trainer coach",
         "Personal training sessions with our certified coaches are 25 GBP each, or 100 GBP for a 5-pack and 180 GBP for a 10-pack. Platinum members get unlimited PT included."),
        ("nutrition", "nutrition diet meal plan coach",
         "Nutrition coaching with our in-house dietitian is 30 GBP per month and includes a personalised meal plan and monthly check-ins."),
        ("classes", "classes timetable schedule group",
         "We run yoga, HIIT, spin, CrossFit and personal training. Classes are included in every membership; check with Maya to book a spot."),
    ]
    for topic, keywords, answer in kb_rows:
        await conn.execute(
            "INSERT INTO gym_kb (topic, keywords, answer) VALUES ($1,$2,$3)",
            topic, keywords, answer,
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
    async def _last_conversation(self, member_name: str) -> dict[str, Any] | None:
        """The member's most recent finished conversation (cross-call memory).

        Lets the agent greet a returning member with context from their last
        call ("welcome back - last time we booked your massage"). The
        conversations table is created by DashboardDB, so guard for the case
        where it does not exist yet.
        """
        try:
            row = await self._fetchrow(
                "SELECT summary, finished_at FROM conversations "
                "WHERE customer_name ILIKE $1 AND status = 'finished' AND summary IS NOT NULL "
                "ORDER BY finished_at DESC LIMIT 1",
                f"%{member_name.strip()}%",
            )
        except Exception:
            return None
        if row is None or not row["summary"]:
            return None
        finished = row["finished_at"]
        days_ago = (date.today() - finished.date()).days if finished is not None else None
        return {"summary": row["summary"], "daysAgo": days_ago}

    async def verify_member(self, args: dict[str, Any]) -> dict[str, Any]:
        """Verify a caller is the member by matching the last digits of their phone."""
        name = str(args.get("name") or "")
        last_digits = str(args.get("lastPhoneDigits") or "").strip()
        member = await self._member(name)
        if member is None:
            raise ValueError("No customer found")
        phone = str(member["phone"] or "")
        if not last_digits:
            raise ValueError("Ask the member for the last two digits of their phone number first")
        if not phone.endswith(last_digits):
            raise ValueError("Verification failed - the phone digits do not match")
        return {
            "name": member["name"],
            "verified": True,
            "phoneMasked": phone[:3] + "***" + phone[-2:],
        }

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
            "phone": str(member["phone"] or ""),
            "upcomingBookings": await self._upcoming_bookings(member["name"]),
            "lastVisit": await self._last_conversation(member["name"]),
            "recommendations": self._recommendations(member),
        }

    @staticmethod
    def _recommendations(member: asyncpg.Record) -> list[dict[str, str]]:
        """Data-driven upsell suggestions based on the member's profile.

        Each item is a short, natural offer the agent can make once during a
        call. Rules use the seeded profile fields: tier, days to expiry,
        visits this month and lifetime value.
        """
        out: list[dict[str, str]] = []
        tier = member["tier"]
        days_left = (member["expires_on"] - date.today()).days
        visits = int(member["visits_this_month"])
        ltv = float(member["ltv"])
        if tier == "Silver":
            if visits >= 10:
                out.append({"offer": "Gold upgrade", "text": "You're visiting often - Gold is only 59 GBP a month and adds spa access plus two personal training sessions. Should I send the upgrade request?"})
            else:
                out.append({"offer": "PT 5-pack", "text": "A personal training 5-pack is 100 GBP and a great way to hit your goals. Want me to add one?"})
        elif tier == "Gold":
            if days_left <= 30:
                out.append({"offer": "Platinum upgrade", "text": "Since your renewal is coming up, Platinum is just 99 GBP a month and includes unlimited personal training and the full spa. Want me to send the upgrade request?"})
            else:
                out.append({"offer": "Guest day pass", "text": "A guest day pass is 15 GBP - perfect for bringing a friend to try the gym. Should I add one?"})
        if ltv >= 3000:
            out.append({"offer": "Referral", "text": "As one of our most valued members, bring a friend and you both get a free guest day pass. Want details?"})
        return out[:2]

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

    async def request_upgrade(self, args: dict[str, Any]) -> dict[str, Any]:
        """Upgrade requests are queued for a staff member; tier is NOT changed."""
        name = str(args.get("customerName") or "")
        target = str(args.get("tier") or "Gold").capitalize()
        member = await self._member(name)
        if member is None:
            raise ValueError("No customer found")
        if target not in TIER_PRICES:
            raise ValueError(f"{target} is not a membership tier (Silver, Gold or Platinum)")
        if target == member["tier"]:
            raise ValueError(f"{name} is already on the {member['tier']} plan")
        request_id = f"REQ-{random.randint(1000, 9999)}"
        await self._run(
            "INSERT INTO staff_requests (request_id, member_name, request_type, details, status) "
            "VALUES ($1,$2,'upgrade',$3,'pending')",
            request_id, name, f"upgrade {member['tier']} -> {target}",
        )
        return {
            "requestId": request_id, "member": name,
            "currentTier": member["tier"], "requestedTier": target,
            "status": "pending", "price": TIER_PRICES.get(target, "59.00 GBP"),
        }

    async def renew_membership(self, args: dict[str, Any]) -> dict[str, Any]:
        """Renewal requests are queued for a staff member; the plan is NOT renewed."""
        name = str(args.get("customerName") or "")
        member = await self._member(name)
        if member is None:
            raise ValueError("No customer found")
        request_id = f"REQ-{random.randint(1000, 9999)}"
        await self._run(
            "INSERT INTO staff_requests (request_id, member_name, request_type, details, status) "
            "VALUES ($1,$2,'renewal',$3,'pending')",
            request_id, name, f"renew {member['tier']} (expires {member['expires_on']})",
        )
        return {
            "requestId": request_id, "member": name,
            "tier": member["tier"], "expiresOn": str(member["expires_on"]),
            "status": "pending", "price": TIER_PRICES.get(member["tier"], "39.00 GBP"),
        }

    async def get_membership_plans(self, args: dict[str, Any]) -> dict[str, Any]:
        """All membership tiers with prices and perks, for the plans tool."""
        rows = await self._fetch(
            "SELECT tier, price, perks FROM membership_plans ORDER BY price"
        )
        return {
            "plans": [
                {
                    "tier": r["tier"],
                    "price": f"{float(r['price']):.2f} GBP",
                    "perks": r["perks"],
                }
                for r in rows
            ]
        }

    async def search_knowledge_base(self, args: dict[str, Any]) -> dict[str, Any]:
        """Keyword-match a gym question against the knowledge base (hours,
        policies, guest passes, parking, PT pricing, classes, nutrition)."""
        query = str(args.get("query") or "").strip()
        if not query:
            raise ValueError("A query is required")
        rows = await self._fetch(
            "SELECT topic, keywords, answer FROM gym_kb "
            "WHERE $1 ILIKE '%' || keywords || '%' "
            "OR keywords ILIKE '%' || $1 || '%' "
            "OR $1 ILIKE '%' || topic || '%' "
            "ORDER BY id LIMIT 3",
            query,
        )
        if not rows:
            return {"answer": None, "matches": []}
        return {
            "answer": rows[0]["answer"],
            "matches": [{"topic": r["topic"], "answer": r["answer"]} for r in rows],
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
            # Not a product - check whether it's a class (spaces left selling).
            class_row = await self._fetchrow(
                "SELECT c.name, c.capacity, c.instructor, "
                "(SELECT count(*) FROM bookings b WHERE lower(b.service) = lower(c.name) AND b.status = 'confirmed' AND b.date >= $2) AS booked "
                "FROM gym_classes c WHERE lower(c.name) = lower($1)",
                name, date.today().isoformat(),
            )
            if class_row is None:
                raise ValueError(f"{name} not found")
            spots = max(0, int(class_row["capacity"]) - int(class_row["booked"]))
            return {
                "item": class_row["name"],
                "kind": "class",
                "spotsLeft": spots,
                "capacity": int(class_row["capacity"]),
                "instructor": class_row["instructor"],
                "available": spots > 0,
            }
        return {"item": row["name"], "available": int(row["stock"]), "inStock": int(row["stock"]) > 0, "location": "Gym Floor"}

    async def list_classes(self, args: dict[str, Any]) -> dict[str, Any]:
        """All classes with instructor, capacity and spots left today."""
        rows = await self._fetch(
            "SELECT c.name, c.category, c.duration_min, c.instructor, c.capacity, "
            "(SELECT count(*) FROM bookings b WHERE lower(b.service) = lower(c.name) "
            " AND b.status = 'confirmed' AND b.date >= $1) AS booked "
            "FROM gym_classes c ORDER BY c.name",
            date.today().isoformat(),
        )
        return {
            "classes": [
                {
                    "name": r["name"],
                    "category": r["category"],
                    "durationMin": int(r["duration_min"]),
                    "instructor": r["instructor"],
                    "spotsLeft": max(0, int(r["capacity"]) - int(r["booked"])),
                }
                for r in rows
            ]
        }

    async def send_email(self, args: dict[str, Any]) -> dict[str, Any]:
        return {
            "messageId": f"MSG-{random.randint(1000, 9999)}",
            "to": str(args.get("to") or "member@gym.example"),
            "subject": str(args.get("subject") or "Your gym confirmation"),
            "status": "sent",
        }
