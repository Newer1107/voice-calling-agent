"""Webhook-backed tool: POSTs to n8n workflows per shared/contracts/webhook.md.

Request envelope: ``POST {N8N_WEBHOOK_BASE_URL}/{tool path}`` with JSON body
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
    """The five default n8n tools, all funneled through webhooks."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.name = "webhook_tool"
        self.description = (
            "Perform actions and lookups by calling an n8n workflow: book an appointment, "
            "create an order, look up a customer, check inventory, or send an email. "
            "Pass the workflow name in 'tool' and its parameters in 'params'."
        )
        self._n8n = N8NClient(settings)
        self._tools: dict[str, dict[str, Any]] = {
            "bookAppointment": {"path": "/book-appointment", "description": "Book an appointment. Params: date (ISO date), time (HH:MM), customerName, notes (optional)."},
            "createOrder": {"path": "/create-order", "description": "Create an order. Params: customerName, items (list of {name, quantity}), notes (optional)."},
            "lookupCustomer": {"path": "/lookup-customer", "description": "Look up a customer by name or email. Params: name or email."},
            "checkInventory": {"path": "/check-inventory", "description": "Check product availability. Params: productName or productId."},
            "sendEmail": {"path": "/send-email", "description": "Send an email. Params: to, subject, body."},
        }

    # -- Tool protocol -------------------------------------------------------
    def schema(self) -> dict[str, Any]:
        """OpenAI function schema exposing the five webhook tools."""
        properties: dict[str, Any] = {}
        for name, spec in self._tools.items():
            properties[name] = {"type": "object", "description": spec["description"]}
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": ["tool"],
                },
            },
        }

    async def execute(self, args: dict[str, Any], session_id: str) -> ToolResult:
        """Dispatch to the requested n8n workflow (never raises)."""
        tool_name = args.get("tool")
        spec = self._tools.get(tool_name)
        if spec is None:
            return ToolResult(ok=False, summary=f"Unknown workflow '{tool_name}'", error=f"unknown workflow: {tool_name}")
        params = args.get("params") or {}
        envelope = {"tool": tool_name, "sessionId": session_id, "params": params}
        url = f"{self.settings.n8n_webhook_base_url.rstrip('/')}{spec['path']}"
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
