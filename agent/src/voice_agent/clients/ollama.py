"""Ollama LLM backend (OpenAI-compatible ``/v1/chat/completions``).

Streaming requests are best-effort: a failed stream raises a retryable
LLMError so the session falls back to a non-streaming completion (which
retries internally with exponential backoff up to ``OLLAMA_MAX_RETRIES``).
"""

from __future__ import annotations

import asyncio
import json
import re
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


def _tool_call_from_text(content: str) -> ToolCall | None:
    """Detect a tool call the model wrote as text instead of using the
    structured ``tool_calls`` field.

    Two shapes are handled:
    - JSON-in-prose: ``{"name": ..., "arguments": {...}}`` (with or without a
      prose preamble).
    - Plain-text call: ``lookupCustomer(name: Sarah)``.
    """
    start = content.find("{")
    if start != -1:
        depth = 0
        end = -1
        in_string = False
        escape = False
        for i in range(start, len(content)):
            ch = content[i]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end != -1:
            try:
                obj = json.loads(content[start : end + 1])
            except (json.JSONDecodeError, TypeError):
                obj = None
            if isinstance(obj, dict):
                name = obj.get("name")
                parameters = obj.get("parameters") or obj.get("arguments")
                if isinstance(name, str) and isinstance(parameters, dict):
                    return ToolCall(id="text_call", name=name, arguments=parameters)
                if isinstance(obj.get("tool"), str) and isinstance(obj.get("params"), dict):
                    return ToolCall(id="text_call", name=obj["tool"], arguments=obj["params"])
    return _tool_call_from_name_args(content)


_NAME_ARGS = re.compile(r"\b([a-zA-Z][a-zA-Z0-9_]*)\s*\(\s*([^()]*?)\s*\)")


def _tool_call_from_name_args(content: str) -> ToolCall | None:
    """Fallback for the plain-text form the model sometimes emits instead of
    JSON: ``lookupCustomer(name: Sarah)``. Requires at least one ``key: value``
    pair inside the parens so ordinary prose like ``Hi (everyone)`` is skipped.
    """
    for match in _NAME_ARGS.finditer(content):
        name, args_raw = match.group(1), match.group(2)
        if ":" not in args_raw:
            continue
        args: dict[str, Any] = {}
        for part in re.split(r",\s*(?=[A-Za-z_])", args_raw):
            kv = re.split(r":\s*", part, maxsplit=1)
            if len(kv) != 2:
                continue
            key = kv[0].strip().strip("'\"")
            value = kv[1].strip().strip("'\"")
            lowered = value.lower()
            if lowered == "true":
                value = True
            elif lowered == "false":
                value = False
            elif re.fullmatch(r"-?\d+", value):
                value = int(value)
            args[key] = value
        if name and args:
            return ToolCall(id="text_call", name=name, arguments=args)
    return None


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
                    if not tool_calls:
                        content = message.get("content") or ""
                        text_call = _tool_call_from_text(content)
                        if text_call is not None:
                            return LLMResponse(content="", tool_calls=[text_call])
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
