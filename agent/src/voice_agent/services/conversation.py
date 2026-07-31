"""Per-session conversation history.

Sessions are created lazily and idempotently; messages are stored in OpenAI
conversation shape (user / assistant / tool) so history can be handed
straight to the chat-completions API. Tool records (assistant ``tool_calls``
and their ``tool`` responses) are stored alongside so a tool round can be
replayed and is visible through the history API.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from ..logging_config import get_logger

logger = get_logger("conversation")

Role = Literal["user", "assistant", "tool"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ConversationMessage:
    """One stored message (OpenAI wire shape plus a timestamp)."""

    role: Role
    content: str
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None  # OpenAI-serialized tool_calls
    created_at: str = field(default_factory=_now)

    def to_llm(self) -> dict[str, Any]:
        """Wire shape accepted by the OpenAI-compatible chat API."""
        message: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.tool_call_id is not None:
            message["tool_call_id"] = self.tool_call_id
        if self.tool_calls:
            message["tool_calls"] = self.tool_calls
        return message

    def to_api(self) -> dict[str, Any]:
        """Wire shape for GET /history/{session_id}; frontend reads text/timestamp."""
        message = self.to_llm()
        message["createdAt"] = self.created_at
        message["text"] = self.content
        message["timestamp"] = self.created_at
        return message


@dataclass
class Conversation:
    """A single conversation session's state."""

    session_id: str
    created_at: str = field(default_factory=_now)
    closed_at: str | None = None
    messages: list[ConversationMessage] = field(default_factory=list)

    @property
    def closed(self) -> bool:
        return self.closed_at is not None


class ConversationManager:
    """asyncio-locked registry of per-session conversations."""

    def __init__(self, history_limit: int) -> None:
        self._history_limit = history_limit
        self._sessions: dict[str, Conversation] = {}
        self._lock = asyncio.Lock()

    async def get_or_create(self, session_id: str) -> Conversation:
        """Return the conversation for session_id, creating it if missing (idempotent)."""
        async with self._lock:
            conversation = self._sessions.get(session_id)
            if conversation is None:
                conversation = Conversation(session_id=session_id)
                self._sessions[session_id] = conversation
                logger.info("session created", extra={"event": "session.created", "session_id": session_id})
            return conversation

    async def add_message(self, session_id: str, message: ConversationMessage) -> Conversation:
        """Append a message, trimming history to SESSION_HISTORY_LIMIT."""
        async with self._lock:
            conversation = self._sessions.get(session_id)
            if conversation is None:
                conversation = Conversation(session_id=session_id)
                self._sessions[session_id] = conversation
            if conversation.closed:
                # Idempotent re-open: a late tool result must not orphan history.
                conversation.closed_at = None
            conversation.messages.append(message)
            self._trim(conversation)
            return conversation

    def _trim(self, conversation: Conversation) -> None:
        """Drop oldest messages past the limit, keeping tool pairs intact."""
        if len(conversation.messages) <= self._history_limit:
            return
        cut = len(conversation.messages) - self._history_limit
        # Never start history with a dangling tool message (its assistant
        # tool_calls counterpart was trimmed) or an assistant tool_calls
        # message whose tool responses were trimmed.
        while cut < len(conversation.messages) and (
            conversation.messages[cut].role == "tool"
            or (conversation.messages[cut].role == "assistant" and conversation.messages[cut].tool_calls)
        ):
            cut += 1
        del conversation.messages[:cut]

    async def history_for_llm(self, session_id: str) -> list[dict[str, Any]]:
        """Conversation history in OpenAI wire format for the chat API."""
        async with self._lock:
            conversation = self._sessions.get(session_id)
            if conversation is None:
                return []
            return [message.to_llm() for message in conversation.messages]

    async def history(self, session_id: str) -> Conversation | None:
        """Return the conversation, or None when the session is unknown."""
        async with self._lock:
            return self._sessions.get(session_id)

    async def close(self, session_id: str) -> None:
        """Close a session. Idempotent; safe to call multiple times."""
        async with self._lock:
            conversation = self._sessions.get(session_id)
            if conversation is None or conversation.closed:
                return
            conversation.closed_at = _now()
            logger.info("session closed", extra={"event": "session.closed", "session_id": session_id})
