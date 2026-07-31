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
from pydantic import BaseModel, Field

from .. import __version__
from ..config import Settings
from ..logging_config import get_logger
from ..services.conversation import ConversationManager

logger = get_logger("api")


class TokenRequest(BaseModel):
    """Body of POST /token."""

    roomName: str = Field(min_length=1, max_length=255)


class TokenResponse(BaseModel):
    """Issued LiveKit credentials: a short-lived JWT plus the server URL."""

    token: str
    url: str
    identity: str


def create_app(settings: Settings, conversations: ConversationManager) -> FastAPI:
    """Build the helper FastAPI application."""

    app = FastAPI(title="Voice Agent API", version=__version__, docs_url=None, redoc_url=None)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/token", response_model=TokenResponse)
    async def token(body: TokenRequest) -> TokenResponse:
        """Issue a short-lived LiveKit join token for the requested room."""
        identity = f"web-{uuid.uuid4().hex[:12]}"
        jwt = (
            AccessToken(api_key=settings.livekit_api_key, api_secret=settings.livekit_api_secret)
            .with_identity(identity)
            .with_ttl(timedelta(hours=1))
            .with_grants(VideoGrants(room_join=True, room=body.roomName))
            .to_jwt()
        )
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
