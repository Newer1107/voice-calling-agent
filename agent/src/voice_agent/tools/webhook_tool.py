"""Webhook-backed tools: one OpenAI function per n8n workflow.

Request envelope: ``POST {N8N_WEBHOOK_BASE_URL}/{path}`` with JSON body
``{"tool": <name>, "sessionId": <session id>, "params": <args>}``.

Response envelope: ``{"ok": bool, "data"?: any, "error"?: string}``.

The HTTP hop (client, retry/backoff, response-shape validation) lives in
:class:`voice_agent.clients.n8n.N8NClient`; its policy is unchanged: 5xx,
network errors, and timeouts are retried with exponential backoff up to
``N8N_WEBHOOK_MAX_RETRIES``; 4xx responses are a permanent failure; a
malformed (unparseable) response body is treated as a tool failure. All
failures are returned as ``ToolResult(ok=False, ...)`` so the LLM sees the
error and can recover conversationally.
"""

from __future__ import annotations

from typing import Any

from ..clients.n8n import N8NClient, WebhookToolError
from ..config import Settings
from ..logging_config import get_logger
from .manager import ToolResult

logger = get_logger("tools.webhook")


class WebhookTool:
    """One n8n-webhook-backed tool: a single OpenAI function schema."""

    def __init__(
        self,
        settings: Settings,
        name: str,
        description: str,
        parameters: dict[str, Any],
        path: str,
    ) -> None:
        self.settings = settings
        self.name = name
        self.description = description
        self._parameters = parameters
        self._path = path
        self._n8n = N8NClient(settings)

    def schema(self) -> dict[str, Any]:
        """OpenAI function schema for this single tool."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self._parameters,
            },
        }

    async def execute(self, args: dict[str, Any], session_id: str) -> ToolResult:
        """POST the args to the n8n workflow (never raises)."""
        params = args or {}
        envelope = {"tool": self.name, "sessionId": session_id, "params": params}
        url = f"{self.settings.n8n_webhook_base_url.rstrip('/')}{self._path}"
        try:
            data = await self._n8n.post(url, envelope)
        except WebhookToolError as exc:
            return ToolResult(ok=False, summary=str(exc), error=str(exc))
        ok = data.get("ok")
        if not isinstance(ok, bool):
            return ToolResult(ok=False, summary="invalid webhook response: missing boolean 'ok'", error="invalid webhook response")
        return ToolResult(ok=ok, summary=str(data.get("data") or data.get("error") or "completed"), data=data)

    async def aclose(self) -> None:
        await self._n8n.aclose()


def build_default_tools(settings: Settings) -> list[WebhookTool]:
    """The seven default gym tools, one OpenAI function per n8n workflow."""
    return [
        WebhookTool(
            settings,
            name="bookAppointment",
            description=(
                "Book a gym session for a member. Call when the user wants to book, reserve, "
                "or schedule a class or personal training session."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "customerName": {"type": "string", "description": "Member's name"},
                    "session": {"type": "string", "description": "Class or session name, e.g. Yoga Basics"},
                    "date": {"type": "string", "description": "Date in ISO format, e.g. 2026-08-05. Omit and n8n defaults to today."},
                    "time": {"type": "string", "description": "Time in 24h HH:MM, e.g. 18:30. Omit and n8n defaults to 18:00."},
                },
                "required": ["customerName", "session"],
            },
            path="/book-appointment",
        ),
        WebhookTool(
            settings,
            name="bookSpaAppointment",
            description=(
                "Book a spa treatment at the gym spa (Swedish massage, deep tissue massage, "
                "sauna session, aromatherapy facial, hot stone therapy). Call when the user "
                "wants to book, reserve, or schedule any spa, massage, sauna, or facial."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "customerName": {"type": "string", "description": "Member's name"},
                    "service": {"type": "string", "description": "Spa treatment name, e.g. Swedish Massage"},
                    "date": {"type": "string", "description": "Date in ISO format, e.g. 2026-08-05. Omit and n8n defaults to today."},
                    "time": {"type": "string", "description": "Time in 24h HH:MM, e.g. 16:00. Omit and n8n defaults to 16:00."},
                },
                "required": ["customerName", "service"],
            },
            path="/book-spa-appointment",
        ),
        WebhookTool(
            settings,
            name="cancelBooking",
            description=(
                "Cancel a member's gym class, personal training or spa booking. "
                "Call when the user wants to cancel, remove, or reschedule a booking, "
                "appointment, class, massage or spa session - including 'cancel all "
                "my bookings' (pass the member's name)."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "customerName": {"type": "string", "description": "Member's name"},
                    "session": {"type": "string", "description": "Class, training or spa session name, e.g. Personal Training or Swedish Massage"},
                    "bookingId": {"type": "string", "description": "Booking id if the user has one, e.g. GYM-3482 or SPA-1909"},
                    "date": {"type": "string", "description": "Date in ISO format, e.g. 2026-08-05. Omit and n8n cancels the most recent booking."},
                },
                "required": ["customerName"],
            },
            path="/cancel-booking",
        ),
        WebhookTool(
            settings,
            name="getMembership",
            description=(
                "Get a member's membership details: tier, status, expiry date, days remaining "
                "and renewal price. Call whenever a member gives their name or asks about their "
                "membership, plan, tier, expiry, renewal, or when it runs out."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Member name"},
                    "email": {"type": "string", "description": "Member email"},
                },
                "description": "Provide at least one of name or email",
            },
            path="/get-membership",
        ),
        WebhookTool(
            settings,
            name="upgradeMembership",
            description=(
                "Upgrade a member's gym membership to a higher tier (Gold or Platinum). "
                "Call when the user wants to upgrade, change, or switch their membership plan "
                "or tier. Never claim an upgrade succeeded without calling this tool."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "customerName": {"type": "string", "description": "Member's name"},
                    "tier": {"type": "string", "description": "Target tier: Gold or Platinum"},
                },
                "required": ["customerName", "tier"],
            },
            path="/upgrade-membership",
        ),
        WebhookTool(
            settings,
            name="createOrder",
            description=(
                "Order gym merchandise (shirts, resistance bands, protein shakes, etc.). "
                "Call when the user wants to buy or order gym products."
            ),
            parameters={
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
            path="/create-order",
        ),
        WebhookTool(
            settings,
            name="lookupCustomer",
            description=(
                "Look up a gym member's account (membership tier, status, visits). "
                "Call when the user asks about their membership, plan, tier, or account details."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Member name"},
                    "email": {"type": "string", "description": "Member email"},
                },
                "description": "Provide at least one of name or email",
            },
            path="/lookup-customer",
        ),
        WebhookTool(
            settings,
            name="checkInventory",
            description=(
                "Check whether gym equipment or merchandise is in stock. "
                "Call when the user asks about availability of a product or equipment."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "productName": {"type": "string", "description": "Product or equipment name"},
                    "productId": {"type": "string", "description": "Product id if known"},
                },
                "description": "Provide at least one of productName or productId",
            },
            path="/check-inventory",
        ),
        WebhookTool(
            settings,
            name="sendEmail",
            description="Send an email. Call when the user wants to send, email, or message someone.",
            parameters={
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email"},
                    "subject": {"type": "string", "description": "Email subject"},
                    "body": {"type": "string", "description": "Email body"},
                },
                "required": ["to", "subject", "body"],
            },
            path="/send-email",
        ),
    ]
