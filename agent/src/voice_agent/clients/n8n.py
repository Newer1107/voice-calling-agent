"""n8n webhook HTTP client.

Extracted from the former ``tools/webhook_tool.py``: owns the httpx
AsyncClient, the envelope POST with retry/backoff, and response-shape
validation. Retry/error policy (unchanged): 5xx, network errors, and
timeouts are retried with exponential backoff up to
``N8N_WEBHOOK_MAX_RETRIES``; 4xx responses are a permanent failure; a
malformed (unparseable) response body is treated as a failure. All terminal
failures raise :class:`WebhookToolError`.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from ..config import Settings
from ..logging_config import get_logger

logger = get_logger("clients.n8n")

N8N_TIMEOUT_CEIL_S = 60.0


class WebhookToolError(Exception):
    """A webhook tool failure with the error surfaced to the LLM."""


class N8NClient:
    """HTTP client for the n8n webhook endpoint (one shared AsyncClient)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.n8n_webhook_base_url.rstrip("/"),
            timeout=httpx.Timeout(min(settings.n8n_webhook_timeout_ms / 1000.0, N8N_TIMEOUT_CEIL_S)),
        )

    async def post(self, url: str, envelope: dict[str, Any]) -> dict[str, Any]:
        """POST the webhook envelope and return the parsed JSON body.

        Retries 5xx/network/timeout with ``2**attempt`` backoff up to
        ``N8N_WEBHOOK_MAX_RETRIES``; raises :class:`WebhookToolError` on any
        terminal failure (4xx, non-JSON body, retries exhausted).
        """
        last_error: Exception | None = None
        for attempt in range(self.settings.n8n_webhook_max_retries + 1):
            try:
                response = await self._client.post(url, json=envelope)
            except (httpx.TimeoutException, httpx.HTTPError) as exc:
                last_error = exc
                if attempt < self.settings.n8n_webhook_max_retries:
                    await asyncio.sleep(2**attempt)
                continue
            if response.status_code >= 500:
                last_error = WebhookToolError(f"webhook {tool_label(url)} http {response.status_code}")
                if attempt < self.settings.n8n_webhook_max_retries:
                    await asyncio.sleep(2**attempt)
                continue
            if response.status_code >= 400:
                raise WebhookToolError(f"webhook {tool_label(url)} http {response.status_code}: {response.text[:200]}")
            try:
                return response.json()
            except (json.JSONDecodeError, ValueError) as exc:
                raise WebhookToolError(f"webhook {tool_label(url)} returned non-JSON response") from exc
        raise WebhookToolError(f"webhook {tool_label(url)} failed after retries: {last_error}")

    async def aclose(self) -> None:
        await self._client.aclose()


def tool_label(url: str) -> str:
    """Short label for logs: the path after the base URL."""
    try:
        return url.split("/", 3)[-1] or url
    except Exception:
        return url
