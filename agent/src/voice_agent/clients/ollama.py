"""Ollama LLM backend (OpenAI-compatible ``/v1/chat/completions``).

Streaming requests are best-effort: a failed stream raises a retryable
LLMError so the session falls back to a non-streaming completion (which
retries internally with exponential backoff up to ``OLLAMA_MAX_RETRIES``).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

import httpx

from ..config import Settings
from ..logging_config import get_logger
from ..tools.manager import ToolManager
from .base import LLMError, LLMResponse, LLMStreamEvent, LLMTextDelta, LLMToolCalls, ToolCall
from .prompts import build_system_prompt

logger = get_logger("clients.ollama")

OLLAMA_TIMEOUT_CEIL_S = 90.0


def _status_retryable(status: int) -> bool:
    return status >= 500 or status in (408, 429)


class OllamaClient:
    """OpenAI-compatible client for Ollama's chat endpoint."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_url = settings.ollama_base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(min(settings.ollama_timeout_ms / 1000.0, OLLAMA_TIMEOUT_CEIL_S)),
            limits=httpx.Limits(max_connections=5, max_keepalive_connections=5),
        )
        self._system_prompt: str | None = None
        self._tools: list[dict[str, Any]] | None = None

    # -- LLMClient API -------------------------------------------------------
    async def stream(
        self,
        history: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[LLMStreamEvent]:
        system_prompt, tools = self._prepare(history, tools)
        payload: dict[str, Any] = {
            "model": self.settings.ollama_model,
            "messages": [{"role": "system", "content": system_prompt}, *history],
            "temperature": self.settings.ollama_temperature,
            "max_tokens": self.settings.ollama_max_tokens,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools
        try:
            async with self._client.stream("POST", "/v1/chat/completions", json=payload) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", "replace")[:500]
                    raise LLMError(f"ollama http {response.status_code}: {body}", retryable=_status_retryable(response.status_code))
                pending: dict[int, dict[str, Any]] = {}
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    delta = chunk.get("choices", [{}])[0].get("delta", {}) if chunk.get("choices") else {}
                    if delta.get("content"):
                        yield LLMTextDelta(delta["content"])
                    if delta.get("tool_calls"):
                        for tc in delta["tool_calls"]:
                            idx = int(tc.get("index", 0))
                            acc = pending.setdefault(idx, {"function": {}})
                            if tc.get("id"):
                                acc["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                acc["function"]["name"] = fn["name"]
                            args = fn.get("arguments")
                            if isinstance(args, str):
                                acc["function"]["arguments"] = acc["function"].get("arguments", "") + args
                            elif isinstance(args, dict):
                                acc["function"]["arguments"] = args
                        yield LLMToolCalls(tool_calls=[self._parse_tool_call(pending[i], i) for i in sorted(pending)])
        except httpx.TimeoutException as exc:
            raise LLMError(f"ollama streaming timed out: {exc}") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"ollama streaming failed: {exc}") from exc

    async def complete(
        self,
        history: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        system_prompt, tools = self._prepare(history, tools)
        payload: dict[str, Any] = {
            "model": self.settings.ollama_model,
            "messages": [{"role": "system", "content": system_prompt}, *history],
            "temperature": self.settings.ollama_temperature,
            "max_tokens": self.settings.ollama_max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
        last_error: Exception | None = None
        for attempt in range(self.settings.ollama_max_retries + 1):
            try:
                response = await self._client.post("/v1/chat/completions", json=payload)
                if response.status_code != 200:
                    body = response.text[:500]
                    error = LLMError(f"ollama http {response.status_code}: {body}", retryable=_status_retryable(response.status_code))
                    if not error.retryable or attempt == self.settings.ollama_max_retries:
                        raise error
                    last_error = error
                else:
                    data = response.json()
                    message = data.get("choices", [{}])[0].get("message", {})
                    tool_calls = [self._parse_tool_call(tc, idx) for idx, tc in enumerate(message.get("tool_calls") or [])]
                    return LLMResponse(content=message.get("content") or "", tool_calls=tool_calls)
            except (httpx.TimeoutException, httpx.HTTPError) as exc:
                error = LLMError(f"ollama request failed: {exc}")
                if attempt == self.settings.ollama_max_retries:
                    raise error from exc
                last_error = error
            if attempt < self.settings.ollama_max_retries:
                await asyncio.sleep(2**attempt)
        raise LLMError(f"ollama failed: {last_error}")

    async def aclose(self) -> None:
        await self._client.aclose()

    # -- internals -----------------------------------------------------------
    def _prepare(self, history: list[dict[str, Any]], tools: list[dict[str, Any]] | None) -> tuple[str, list[dict[str, Any]] | None]:
        if self._system_prompt is None or (tools is not None and tools != self._tools):
            self._tools = tools
            self._system_prompt = build_system_prompt(self.settings, tools or [])
        return self._system_prompt or "", tools

    @staticmethod
    def _parse_tool_call(raw: dict[str, Any], index: int) -> ToolCall:
        call_id = raw.get("id") or f"call_{index}"
        function = raw.get("function") or {}
        name = function.get("name") or "unknown"
        arguments_raw = function.get("arguments") or "{}"
        try:
            arguments = json.loads(arguments_raw) if isinstance(arguments_raw, str) else arguments_raw
            return ToolCall(id=call_id, name=name, arguments=arguments)
        except (json.JSONDecodeError, TypeError) as exc:
            return ToolCall(id=call_id, name=name, arguments={}, arguments_parse_error=f"invalid arguments: {exc}")
