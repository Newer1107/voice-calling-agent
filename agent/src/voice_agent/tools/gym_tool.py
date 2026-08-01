"""DB-backed gym tools: one OpenAI function per live Postgres operation.

Replaces the n8n webhook mock: tool execution now reads from and writes to the
seeded gym database (members, memberships, bookings, products, orders) in real
time. Request/response envelopes are identical to the webhook contract, so the
session pipeline, prompt and dashboard are unchanged.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..config import Settings
from ..dashboard.gym_db import GymDB
from ..logging_config import get_logger
from .manager import ToolResult

logger = get_logger("tools.gym")

# Names the LLM fabricates when it does not know the member but insists on
# calling a name-requiring tool. Rejected deterministically at the tool layer
# so the conversation never acts on a made-up identity.
_PLACEHOLDER_NAME = re.compile(
    r"(^|[\s-])(john doe|jane doe|test|guest|customer|member|user|unknown|"
    r"placeholder|doesn.?t know|don.?t know|not given|maya|<nil>|\bnil\b|"
    r"n/a|the user|the member|someone|anyone|everyone|him|her|them|they)(\s|$)|"
    r"(may i have|your name|what is|who is|please tell|ask the)",
    re.IGNORECASE,
)

_TOOL_SPECS: list[dict[str, Any]] = [
    {
        "name": "bookAppointment",
        "description": (
            "Book a gym session for a member. Call when the user wants to book, reserve, "
            "or schedule a class or personal training session."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "Member's name"},
                "session": {"type": "string", "description": "Class or session name, e.g. Yoga Basics"},
                "date": {"type": "string", "description": "Date in ISO format, e.g. 2026-08-05. Omit and it defaults to today."},
                "time": {"type": "string", "description": "Time in 24h HH:MM, e.g. 18:30. Omit and it defaults to 18:00."},
            },
            "required": ["customerName", "session"],
        },
        "handler": "book_appointment",
    },
    {
        "name": "bookSpaAppointment",
        "description": (
            "Book a spa treatment at the gym spa (Swedish massage, deep tissue massage, "
            "sauna session, aromatherapy facial, hot stone therapy). Call when the user "
            "wants to book, reserve, or schedule any spa, massage, sauna, or facial."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "Member's name"},
                "service": {"type": "string", "description": "Spa treatment name, e.g. Swedish Massage"},
                "date": {"type": "string", "description": "Date in ISO format, e.g. 2026-08-05. Omit and it defaults to today."},
                "time": {"type": "string", "description": "Time in 24h HH:MM, e.g. 16:00. Omit and it defaults to 16:00."},
            },
            "required": ["customerName", "service"],
        },
        "handler": "book_spa",
    },
    {
        "name": "cancelBooking",
        "description": (
            "Cancel a member's gym class, personal training or spa booking. "
            "Call when the user wants to cancel, remove, or reschedule a booking, "
            "appointment, class, massage or spa session - including 'cancel all "
            "my bookings' (pass the member's name). This is the ONLY tool for "
            "cancellations - do not use lookupCustomer for cancel requests."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "Member's name"},
                "session": {"type": "string", "description": "Class, training or spa session name, e.g. Personal Training or Swedish Massage"},
                "bookingId": {"type": "string", "description": "Booking id if the user has one, e.g. GYM-3482 or SPA-1909"},
                "date": {"type": "string", "description": "Date in ISO format, e.g. 2026-08-05. Omit and it cancels the confirmed bookings."},
            },
            "required": ["customerName"],
        },
        "handler": "cancel_bookings",
    },
    {
        "name": "getMembership",
        "description": (
            "Detailed membership renewal info: tier, status, expiry date, days remaining "
            "and renewal price. Call for renewal or upgrade pricing questions. Use "
            "lookupCustomer for the full member profile when a name is first given."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Member name"},
                "email": {"type": "string", "description": "Member email"},
            },
            "description": "Provide at least one of name or email",
        },
        "handler": "get_membership",
    },
    {
        "name": "upgradeMembership",
        "description": (
            "Queue a membership upgrade request for a gym staff member. Call when the user "
            "wants to upgrade, change, or switch their membership plan or tier, OR asks to "
            "pay for an upgrade or any membership payment. This tool only records the "
            "request for staff - it does NOT change the membership. Never tell the user "
            "the upgrade is done; say their request has been sent to the front desk staff."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "Member's name"},
                "tier": {"type": "string", "description": "Target tier: Gold or Platinum"},
            },
            "required": ["customerName", "tier"],
        },
        "handler": "request_upgrade",
    },
    {
        "name": "renewMembership",
        "description": (
            "Queue a membership renewal request for a gym staff member. Call when the user "
            "wants to renew, extend, or pay to renew their membership. This tool only "
            "records the request for staff - it does NOT renew anything. Never tell the "
            "user the renewal is done; say their request has been sent to the front desk staff."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "Member's name"},
            },
            "required": ["customerName"],
        },
        "handler": "renew_membership",
    },
    {
        "name": "getMembershipPlans",
        "description": (
            "List all IronPeak membership tiers (Silver, Gold, Platinum) with their monthly "
            "prices and perks. Call whenever the user asks about membership options, plans, "
            "prices, or what is included in a tier. Always quote prices from this tool - "
            "never from memory."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
        "handler": "get_membership_plans",
    },
    {
        "name": "searchKnowledgeBase",
        "description": (
            "Search IronPeak's knowledge base for gym facts: opening hours, location, "
            "guest pass policy, membership freeze, cancellation policy, dress code, "
            "parking, personal training pricing, nutrition coaching and class schedule. "
            "Call when the user asks a factual question about the gym that is not a "
            "booking, membership profile, plan or inventory question. Answer using the "
            "returned text."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The user's question or its key terms"},
            },
            "required": ["query"],
        },
        "handler": "search_knowledge_base",
    },
    {
        "name": "lookupCustomer",
        "description": (
            "Load a member's complete profile: membership tier, status, expiry date, "
            "visits this month, upcoming bookings, lastVisit (previous conversation) "
            "and recommendations (data-driven upsell offers). Call the moment a member "
            "gives their name - it is how you know everything about them without asking."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Member name"},
                "email": {"type": "string", "description": "Member email"},
            },
            "description": "Provide at least one of name or email",
        },
        "handler": "lookup_customer",
    },
    {
        "name": "verifyMember",
        "description": (
            "Verify a caller is really the member by matching the last digits of the "
            "phone number on file. Call ONLY when the user offers to verify who they "
            "are or when identity matters (e.g. before sharing sensitive account "
            "details). The profile's phone field shows the last two digits to confirm."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Member name"},
                "lastPhoneDigits": {"type": "string", "description": "Last 2 digits of the phone number on file"},
            },
            "required": ["name", "lastPhoneDigits"],
        },
        "handler": "verify_member",
    },
    {
        "name": "createOrder",
        "description": (
            "Order gym merchandise (protein shakes, resistance bands, gym tees, etc.). "
            "Call when the user wants to buy or order gym products."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "Member's name"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Product name"},
                            "quantity": {"type": "integer", "description": "How many"},
                        },
                        "required": ["name", "quantity"],
                    },
                    "description": "Items to order",
                },
            },
            "required": ["customerName", "items"],
        },
        "handler": "create_order",
    },
    {
        "name": "checkInventory",
        "description": (
            "Check whether gym equipment or merchandise is in stock, OR how many "
            "spots are left in a class. Call when the user asks about availability "
            "of a product, equipment, or whether there is space in a class "
            "(e.g. 'is the sauna available', 'any spots in yoga tomorrow')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "productName": {"type": "string", "description": "Product, equipment or class name"},
                "productId": {"type": "string", "description": "Product id if known"},
            },
            "description": "Provide at least one of productName or productId",
        },
        "handler": "check_inventory",
    },
    {
        "name": "listClasses",
        "description": (
            "List all IronPeak group classes with their instructor, duration and how "
            "many spots are left. Call when the user asks what classes are available, "
            "what the class timetable looks like, or wants to pick a class to book."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
        },
        "handler": "list_classes",
    },
    {
        "name": "requestCallback",
        "description": (
            "Queue a callback request for a gym staff member. Call when the agent "
            "cannot resolve the user's request (no tool fits, a tool keeps failing, "
            "or the user asks for a human). It records the request for staff - tell "
            "the member a staff member will call them back shortly."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customerName": {"type": "string", "description": "Member's name"},
                "reason": {"type": "string", "description": "Why the callback was requested"},
            },
            "required": ["customerName", "reason"],
        },
        "handler": "request_callback",
    },
    {
        "name": "sendEmail",
        "description": "Send an email. Call when the user wants to send, email, or message someone.",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient email"},
                "subject": {"type": "string", "description": "Email subject"},
                "body": {"type": "string", "description": "Email body"},
            },
            "required": ["to", "subject", "body"],
        },
        "handler": "send_email",
    },
]


class GymTool:
    """One DB-backed tool: schema for the LLM plus a GymDB handler."""

    def __init__(self, settings: Settings, spec: dict[str, Any]) -> None:
        self.settings = settings
        self.name = spec["name"]
        self.description = spec["description"]
        self._parameters = spec["parameters"]
        self._handler = spec["handler"]
        self._db = GymDB(settings)

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self._parameters,
            },
        }

    async def execute(self, args: dict[str, Any], session_id: str) -> ToolResult:
        """Run the DB handler; failures become ToolResult(ok=False)."""
        name = str((args or {}).get("customerName") or (args or {}).get("name") or "")
        if name and _PLACEHOLDER_NAME.search(name):
            return ToolResult(
                ok=False,
                summary="Ask the member for their name first - the name given was not a real member name.",
                error="placeholder member name",
            )
        try:
            data = await getattr(self._db, self._handler)(args or {})
            return ToolResult(ok=True, summary=json.dumps(data), data={"data": data})
        except Exception as exc:
            logger.warning("gym tool failed", extra={"event": "tool.failed", "tool": self.name, "error": str(exc)})
            return ToolResult(ok=False, summary=str(exc), error=str(exc))

    async def aclose(self) -> None:
        pass


def build_default_tools(settings: Settings) -> list[GymTool]:
    """The nine gym tools, backed by the live Postgres gym database."""
    return [GymTool(settings, spec) for spec in _TOOL_SPECS]
