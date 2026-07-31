"""FastAPI helper app: token issuance, health, conversation history.

Runs inside the same process as the LiveKit worker (uvicorn task) when
ENABLE_AGENT_API=true. The browser calls POST /token to obtain a short-lived
LiveKit JWT — LiveKit secrets never leave the agent.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit.api import AccessToken, VideoGrants
from livekit.api.agent_dispatch_service import AgentDispatchService
from livekit.api.room_service import RoomService
from livekit.protocol.agent_dispatch import CreateAgentDispatchRequest, RoomAgentDispatch
from livekit.protocol.room import CreateRoomRequest
from pydantic import BaseModel, Field

from .. import __version__
from ..config import Settings
from ..logging_config import get_logger
from ..services.conversation import ConversationManager

logger = get_logger("api")


class TokenRequest(BaseModel):
    """Body of POST /token.

    ``identity`` is optional — when omitted the agent generates a unique
    browser identity (``web-<random>``). When supplied it is used verbatim
    as the LiveKit participant identity.
    """

    roomName: str = Field(min_length=1, max_length=255)
    identity: str | None = Field(default=None, min_length=1, max_length=255)


class TokenResponse(BaseModel):
    """Issued LiveKit credentials: a short-lived JWT plus the server URL."""

    token: str
    url: str
    identity: str


def create_app(
    settings: Settings,
    conversations: ConversationManager,
    hub: Any | None = None,
    db: Any | None = None,
) -> FastAPI:
    """Build the helper FastAPI application."""
    from ..dashboard import build_dashboard_router

    app = FastAPI(title="Voice Agent API", version=__version__, docs_url=None, redoc_url=None)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if settings.enable_dashboard and hub is not None and db is not None:
        app.include_router(build_dashboard_router(settings, hub, db))

    @app.post("/token", response_model=TokenResponse)
    async def token(body: TokenRequest) -> TokenResponse:
        """Issue a short-lived LiveKit join token for the requested room.

        Also creates an explicit agent dispatch for the room so the worker is
        called to join it (LiveKit 1.x does not auto-dispatch room jobs).
        """
        identity = body.identity or f"web-{uuid.uuid4().hex[:12]}"
        jwt = (
            AccessToken(api_key=settings.livekit_api_key, api_secret=settings.livekit_api_secret)
            .with_identity(identity)
            .with_ttl(timedelta(hours=1))
            .with_grants(VideoGrants(room_join=True, room=body.roomName))
            .to_jwt()
        )
        await _ensure_dispatch(settings, body.roomName)
        logger.info(
            "token issued",
            extra={"event": "token.issued", "room": body.roomName, "identity": identity},
        )
        return TokenResponse(token=jwt, url=settings.livekit_url, identity=identity)

    @app.get("/health")
    async def health() -> dict[str, str]:
        """Liveness probe for the helper API."""
        return {"status": "ok", "service": "voice-agent", "version": __version__}

    @app.get("/history/{session_id}")
    async def history(session_id: str) -> dict[str, object]:
        """Conversation history for a session (404 when unknown or closed)."""
        conversation = await conversations.history(session_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="session not found")
        return {
            "sessionId": conversation.session_id,
            "createdAt": conversation.created_at,
            "closedAt": conversation.closed_at,
            "messages": [message.to_api() for message in conversation.messages],
        }

    return app


async def _ensure_dispatch(settings: Settings, room_name: str) -> None:
    """Attach the voice agent to the room so the worker is dispatched to it.

    LiveKit 1.x only calls the worker to join a room when a dispatch exists.
    Order matters: a dispatch cannot target a room that does not exist yet,
    so we create the room WITH the agent embedded in one call. If the room
    already exists (browser joined first), fall back to adding the dispatch
    via AgentDispatchService. Idempotent: repeated /token calls do not stack
    dispatches.
    """
    import aiohttp

    if not settings.enable_agent_api or not settings.livekit_worker_name:
        return
    agent_name = settings.livekit_worker_name
    session = aiohttp.ClientSession()
    try:
        room_service = RoomService(
            session, settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret
        )
        try:
            await room_service.create_room(
                CreateRoomRequest(
                    name=room_name,
                    agents=[RoomAgentDispatch(agent_name=agent_name)],
                )
            )
            logger.info(
                "room created with agent dispatch",
                extra={"event": "dispatch.created", "room": room_name, "agent": agent_name},
            )
            return
        except Exception:
            # room already exists -> ensure the dispatch is present
            pass

        dispatch_service = AgentDispatchService(
            session, settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret
        )
        existing = await dispatch_service.list_dispatch(room_name)
        if any(d.agent_name == agent_name for d in existing):
            return
        await dispatch_service.create_dispatch(
            CreateAgentDispatchRequest(agent_name=agent_name, room=room_name)
        )
        logger.info(
            "agent dispatch created",
            extra={"event": "dispatch.created", "room": room_name, "agent": agent_name},
        )
    except Exception as exc:  # dispatch is best-effort; token still works
        logger.warning(
            "agent dispatch failed",
            extra={"event": "dispatch.failed", "room": room_name, "error": str(exc)},
        )
    finally:
        await session.close()
