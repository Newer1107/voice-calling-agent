"""LiveKit data-channel event publisher.

Envelope and type names MUST match ``shared/contracts/events.schema.json``:
``{type, sessionId, timestamp, payload}``. Agent -> browser types are
``agent.*`` / ``state.*`` / ``transcript.*``; browser -> agent types are
``client.*``. Unknown inbound types are ignored for forward compatibility.

Messages are published on the room's default data channel (no topic) so any
``data_received`` listener sees them; inbound messages arrive on the same
channel. livekit-rtc dispatches room callbacks on the asyncio loop, so the
queue writes below are safe.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import livekit.rtc as rtc

from .logging_config import get_logger

logger = get_logger("events")

_ENVELOPE_TYPES = frozenset(
    {
        "agent.welcome", "agent.message.start", "agent.message.delta",
        "agent.message.done", "transcript.partial", "transcript.final",
        "tool.call", "tool.result", "tool.error", "state.connected",
        "state.listening", "state.speaking", "state.thinking", "error",
        "client.ptt.start", "client.ptt.stop", "client.config",
    }
)


@dataclass
class ClientMessage:
    """A parsed inbound message from the browser (``client.*`` type)."""

    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    session_id: str = ""


def _now() -> str:
    """ISO-8601 UTC timestamp for the envelope."""
    return datetime.now(timezone.utc).isoformat()


class EventPublisher:
    """Publishes contract events to the room data channel and receives client messages."""

    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        self._queue: asyncio.Queue[ClientMessage] | None = None
        self._listening = False

    # ------------------------------------------------------------------
    # Publishing
    # ------------------------------------------------------------------
    async def publish(self, type_: str, payload: dict[str, Any], session_id: str) -> None:
        """Send one envelope over the data channel (best-effort)."""
        if type_ not in _ENVELOPE_TYPES:
            logger.warning("publishing unknown event type", extra={"event_type": type_})
        envelope = {"type": type_, "sessionId": session_id, "timestamp": _now(), "payload": payload}
        try:
            await self._room.local_participant.publish_data(
                json.dumps(envelope, ensure_ascii=False).encode("utf-8")
            )
        except Exception as exc:  # a data-channel failure must never kill the session
            logger.warning("data publish failed", extra={"event_type": type_, "error": str(exc)})

    async def welcome(self, session_id: str, text: str) -> None:
        await self.publish("agent.welcome", {"text": text, "sessionId": session_id, "conversationId": session_id}, session_id)

    async def message_start(self, session_id: str, message_id: str) -> None:
        await self.publish("agent.message.start", {"messageId": message_id}, session_id)

    async def message_delta(self, session_id: str, message_id: str, text: str) -> None:
        await self.publish("agent.message.delta", {"messageId": message_id, "text": text}, session_id)

    async def message_done(self, session_id: str, message_id: str, text: str) -> None:
        await self.publish("agent.message.done", {"messageId": message_id, "text": text}, session_id)

    async def transcript_partial(self, session_id: str, text: str) -> None:
        await self.publish("transcript.partial", {"text": text}, session_id)

    async def transcript_final(self, session_id: str, text: str, *, confidence: float | None = None, language: str | None = None) -> None:
        payload: dict[str, Any] = {"text": text}
        if confidence is not None:
            payload["confidence"] = confidence
        if language is not None:
            payload["language"] = language
        await self.publish("transcript.final", payload, session_id)

    async def tool_call(self, session_id: str, tool: str, arguments: dict[str, Any]) -> None:
        await self.publish("tool.call", {"tool": tool, "arguments": arguments}, session_id)

    async def tool_result(self, session_id: str, tool: str, *, ok: bool, summary: str, data: Any = None) -> None:
        payload: dict[str, Any] = {"tool": tool, "ok": ok, "summary": summary}
        if data is not None:
            payload["data"] = data
        await self.publish("tool.result", payload, session_id)

    async def tool_error(self, session_id: str, tool: str, message: str) -> None:
        await self.publish("tool.error", {"tool": tool, "message": message}, session_id)

    async def state_connected(self, session_id: str) -> None:
        await self.publish("state.connected", {}, session_id)

    async def state_listening(self, session_id: str, active: bool, source: str = "vad") -> None:
        await self.publish("state.listening", {"active": active, "source": source}, session_id)

    async def state_speaking(self, session_id: str, active: bool) -> None:
        await self.publish("state.speaking", {"active": active}, session_id)

    async def state_thinking(self, session_id: str, active: bool) -> None:
        await self.publish("state.thinking", {"active": active}, session_id)

    async def error(self, session_id: str, code: str, message: str, *, recoverable: bool = True) -> None:
        await self.publish("error", {"code": code, "message": message, "recoverable": recoverable}, session_id)

    # ------------------------------------------------------------------
    # Receiving client.* messages
    # ------------------------------------------------------------------
    def start_listening(self) -> None:
        """Start forwarding inbound client.* messages to :meth:`messages`."""
        if self._listening:
            return
        self._queue = asyncio.Queue()
        self._room.on("data_received", self._on_data)
        self._listening = True

    def stop_listening(self) -> None:
        if not self._listening:
            return
        self._room.off("data_received", self._on_data)
        self._queue = None
        self._listening = False

    def _on_data(self, packet: rtc.DataPacket) -> None:
        if self._queue is None:
            return
        try:
            raw = packet.data
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")
            envelope = json.loads(raw)
            type_ = str(envelope.get("type", ""))
            if type_ not in _ENVELOPE_TYPES or not type_.startswith("client."):
                logger.debug("ignoring unknown inbound message", extra={"event_type": type_})
                return
            self._queue.put_nowait(
                ClientMessage(
                    type=type_,
                    payload=envelope.get("payload") or {},
                    session_id=str(envelope.get("sessionId", "")),
                )
            )
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            logger.debug("malformed inbound data message", extra={"error": str(exc)})

    async def messages(self) -> AsyncIterator[ClientMessage]:
        """Async-iterate over inbound client messages until stop_listening."""
        while True:
            queue = self._queue
            if queue is None:
                return
            try:
                yield await queue.get()
            except asyncio.CancelledError:
                return
