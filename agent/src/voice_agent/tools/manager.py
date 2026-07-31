"""Tool registry: discovery schemas for the LLM plus safe execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol, runtime_checkable

from ..config import Settings
from ..logging_config import get_logger

logger = get_logger("tools.manager")


@dataclass
class ToolResult:
    """Outcome of a tool execution, in LLM-readable form."""

    ok: bool
    summary: str
    data: Any = None
    error: str | None = None


@runtime_checkable
class Tool(Protocol):
    """A callable tool with an OpenAI-style JSON Schema for discovery."""

    name: str
    description: str

    def schema(self) -> dict[str, Any]:
        """OpenAI function JSON Schema (``type: function``)."""
        ...

    async def execute(self, args: dict[str, Any], session_id: str) -> ToolResult:
        """Run the tool; must never raise — return ToolResult instead."""
        ...

    async def aclose(self) -> None:
        ...


class ToolManager:
    """Registry that discovers tools, exposes schemas, and executes by name.

    Schemas are exposed to the LLM as ``{"type": "function", "function":
    {...}}``; this shape is what Ollama's ``tools`` parameter expects.
    """

    def __init__(self, tools: list[Tool]) -> None:
        self._tools: dict[str, Tool] = {}
        for tool in tools:
            if tool.name in self._tools:
                raise ValueError(f"duplicate tool name: {tool.name}")
            self._tools[tool.name] = tool

    @classmethod
    def from_settings(cls, settings: Settings) -> "ToolManager":
        """Build the default registry from the configured webhook base URL."""
        from .webhook_tool import WebhookTool  # deferred: breaks manager<->webhook_tool cycle

        return cls([WebhookTool(settings)])

    def schemas(self) -> list[dict[str, Any]]:
        """OpenAI function schemas for all registered tools."""
        return [tool.schema() for tool in self._tools.values()]

    async def execute(self, name: str, args: dict[str, Any], session_id: str) -> ToolResult:
        """Execute a tool by name (raises only for unknown tools)."""
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(ok=False, summary=f"Unknown tool '{name}'", error=f"unknown tool: {name}")
        try:
            return await tool.execute(args, session_id)
        except Exception as exc:  # noqa: BLE001 - tools must never raise
            logger.error("tool raised", extra={"event": "tool.raised", "tool": name, "error": str(exc)})
            return ToolResult(ok=False, summary=f"Tool '{name}' failed: {exc}", error=str(exc))

    async def aclose(self) -> None:
        awaitables: list[Awaitable[Any]] = []
        for tool in self._tools.values():
            closer = getattr(tool, "aclose", None)
            if closer is not None:
                awaitables.append(closer())
        for result in awaitables:
            try:
                await result
            except Exception:  # noqa: BLE001
                pass
