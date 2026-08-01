"""Dashboard API: REST endpoints + /ws/dashboard WebSocket.

Reads from PostgreSQL (DashboardDB) and streams live events via the hub.
System status is probed (TCP connect for remote services; in-process flag for
Whisper) and broadcast every 30s while a client is connected.
"""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from ..config import Settings
from ..logging_config import get_logger
from .db import DashboardDB
from .hub import DashboardHub

logger = get_logger("dashboard.api")

_SYSTEM_CHECK_INTERVAL_S = 30.0
_PROBE_TIMEOUT_S = 3.0


def build_dashboard_router(settings: Settings, hub: DashboardHub, db: DashboardDB) -> APIRouter:
    router = APIRouter(tags=["dashboard"])

    # -- system health -------------------------------------------------------
    async def check_system() -> dict[str, Any]:
        services = hub.snapshot_services()
        services["whisper"] = "ok" if services.get("whisper") == "ok" else "down"
        services["tts"] = await _probe_http("http://localhost:8880")
        services["ollama"] = await _probe_http(settings.ollama_base_url.rstrip("/") + "/v1/models")
        services["n8n"] = await _probe_http(settings.n8n_webhook_base_url)
        services["livekit"] = await _probe_url(settings.livekit_url)
        return {"services": services, "updatedAt": _now_iso()}

    async def broadcast_system() -> None:
        hub.publish("system.status", await check_system())

    # -- REST ----------------------------------------------------------------
    @router.get("/dashboard/overview")
    async def dashboard_overview() -> dict[str, Any]:
        return await db.overview()

    @router.get("/dashboard/conversations")
    async def dashboard_conversations() -> list[dict[str, Any]]:
        return await db.conversations()

    @router.get("/dashboard/conversations/{conversation_id}")
    async def dashboard_conversation(conversation_id: str) -> dict[str, Any]:
        detail = await db.conversation_detail(conversation_id)
        if detail is None:
            return JSONResponse(status_code=404, content={"detail": "conversation not found"})
        return detail

    @router.get("/dashboard/appointments")
    async def dashboard_appointments() -> list[dict[str, Any]]:
        return await db.appointments()

    @router.get("/dashboard/orders")
    async def dashboard_orders() -> list[dict[str, Any]]:
        return await db.orders()

    @router.get("/dashboard/customers")
    async def dashboard_customers() -> list[dict[str, Any]]:
        return await db.customers()

    @router.get("/dashboard/analytics")
    async def dashboard_analytics() -> dict[str, Any]:
        return await db.analytics()

    @router.get("/dashboard/system")
    async def dashboard_system() -> dict[str, Any]:
        return await check_system()

    @router.get("/dashboard/stats")
    async def dashboard_stats() -> dict[str, Any]:
        return await db.stats()

    # -- WebSocket -----------------------------------------------------------
    @router.websocket("/ws/dashboard")
    async def ws_dashboard(websocket: WebSocket) -> None:
        await websocket.accept()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        sub_id = hub.subscribe(queue, loop)
        try:
            try:
                await websocket.send_json({
                    "type": "snapshot",
                    "ts": _now_iso(),
                    "data": {"overview": await db.overview(), "system": await check_system()},
                })
            except Exception as exc:
                logger.warning("dashboard snapshot failed", extra={"error": str(exc)})
            while True:
                try:
                    envelope = await asyncio.wait_for(queue.get(), timeout=_SYSTEM_CHECK_INTERVAL_S)
                except asyncio.TimeoutError:
                    await broadcast_system()
                    continue
                await websocket.send_json(envelope)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning("dashboard ws closed", extra={"error": str(exc)})
        finally:
            hub.unsubscribe(sub_id)

    return router


# -- probes ---------------------------------------------------------------
async def _probe_http(url: str) -> str:
    """Cheap TCP-level probe of the URL host:port (no full HTTP needed)."""
    try:
        parts = urlsplit(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(parts.hostname or "localhost", port), timeout=_PROBE_TIMEOUT_S
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return "ok"
    except Exception:
        return "down"


async def _probe_url(url: str) -> str:
    return await _probe_http(url)


def _now_iso() -> str:
    import datetime as dt

    return dt.datetime.now(dt.timezone.utc).isoformat()
