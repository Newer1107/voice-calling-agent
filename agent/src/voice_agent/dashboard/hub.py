"""Realtime event hub: sessions publish, dashboard WebSocket clients receive.

The agent worker runs its own asyncio loop; the FastAPI helper (and its
WebSocket handlers) run in a separate thread with a separate event loop.
``publish`` is therefore synchronous and thread-safe: each subscriber's queue
is filled via ``call_soon_threadsafe`` on that subscriber's loop.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import threading
from typing import Any

from ..config import Settings
from ..logging_config import get_logger

logger = get_logger("dashboard.hub")

_hub: "DashboardHub | None" = None
_lock = threading.Lock()


def get_hub(settings: Settings) -> "DashboardHub":
    """Process-wide singleton shared by the worker loop and the API thread."""
    global _hub
    if _hub is None:
        with _lock:
            if _hub is None:
                _hub = DashboardHub(settings)
    return _hub


class DashboardHub:
    """Thread-safe pub/sub plus a small in-memory service-health registry."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._subscribers: dict[int, tuple[asyncio.Queue[dict[str, Any]], asyncio.AbstractEventLoop]] = {}
        self._seq = 0
        self._lock = threading.Lock()
        self.services: dict[str, str] = {"whisper": "down"}

    # -- pub/sub -------------------------------------------------------------
    def subscribe(self, queue: asyncio.Queue[dict[str, Any]], loop: asyncio.AbstractEventLoop) -> int:
        with self._lock:
            self._seq += 1
            self._subscribers[self._seq] = (queue, loop)
            return self._seq

    def unsubscribe(self, sub_id: int) -> None:
        with self._lock:
            self._subscribers.pop(sub_id, None)

    def publish(self, type_: str, data: dict[str, Any]) -> None:
        """Broadcast one event; safe to call from any thread or loop."""
        envelope = {"type": type_, "ts": dt.datetime.now(dt.timezone.utc).isoformat(), "data": data}
        with self._lock:
            subscribers = list(self._subscribers.values())
        for queue, loop in subscribers:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, envelope)
            except Exception:
                pass  # subscriber is going away; drop the event for it

    # -- service health ------------------------------------------------------
    def set_service(self, name: str, status: str) -> None:
        with self._lock:
            self.services[name] = status

    def snapshot_services(self) -> dict[str, str]:
        with self._lock:
            return dict(self.services)
