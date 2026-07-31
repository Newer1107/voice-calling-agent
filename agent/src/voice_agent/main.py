"""LiveKit voice-agent worker entrypoint + in-process FastAPI helper.

Run with: ``python -m voice_agent.main`` (from ``agent/`` so ``.env`` is
found). The FastAPI helper (token issuance, history, health) runs in the
same process as a uvicorn task when ENABLE_AGENT_API=true.

The worker is configured with ``num_idle_processes=1`` so jobs run in a
single child process and the in-process API task is a single instance.
Worker -> server reconnects/retries are handled by the livekit-agents
framework defaults.
"""

from __future__ import annotations

import asyncio
import inspect
import threading
import uuid
from typing import Any

import livekit.rtc as rtc
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, WorkerType, cli

from .api import create_app
from .clients.base import LLMClient
from .clients.kokoro import KokoroClient
from .clients.ollama import OllamaClient
from .clients.whisper import WhisperClient
from .config import Settings
from .events import EventPublisher
from .logging_config import get_logger, setup_logging
from .services.conversation import ConversationManager
from .services.session import VoiceSession
from .tools.manager import ToolManager

logger = get_logger("main")


class SharedServices:
    """Clients/state shared across sessions (single worker process)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.conversations = ConversationManager(settings.session_history_limit)
        # 15: STT is intentionally per-session, not shared here
        self.llm: LLMClient = OllamaClient(settings)
        self.tts: KokoroClient = KokoroClient(settings)
        self.tools: ToolManager = ToolManager.from_settings(settings)

    async def aclose(self) -> None:
        await asyncio.gather(
            self.llm.aclose(),
            self.tts.aclose(),
            self.tools.aclose(),
            return_exceptions=True,
        )


_shared: SharedServices | None = None
_api_task: asyncio.Task | None = None


def _get_shared(settings: Settings) -> SharedServices:
    global _shared
    if _shared is None:
        _shared = SharedServices(settings)
    return _shared


async def _run_api(shared: SharedServices) -> None:
    import uvicorn

    app = create_app(shared.settings, shared.conversations)
    config = uvicorn.Config(
        app,
        host=shared.settings.agent_host,
        port=shared.settings.agent_port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    logger.info(
        "agent API starting",
        extra={"event": "api.start", "host": shared.settings.agent_host, "port": shared.settings.agent_port},
    )
    try:
        await server.serve()
    except asyncio.CancelledError:
        logger.info("agent API stopped", extra={"event": "api.stop"})
        raise


def _report_api_failure(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("agent API task failed", extra={"event": "api.failed", "error": str(exc)})


async def _ensure_api_task(shared: SharedServices) -> None:
    global _api_task
    if not shared.settings.enable_agent_api:
        return
    if _api_task is None or _api_task.done():
        _api_task = asyncio.create_task(_run_api(shared), name="agent-api")
        _api_task.add_done_callback(_report_api_failure)


async def _wait_for_participant(room: rtc.Room, timeout: float = 30.0) -> rtc.RemoteParticipant | None:
    """Wait for the first remote participant to join the room."""
    loop = asyncio.get_running_loop()
    future = loop.create_future()

    def _on_join(participant: rtc.RemoteParticipant) -> None:
        if not future.done():
            future.set_result(participant)

    for participant in room.remote_participants.values():
        if not future.done():
            future.set_result(participant)
    room.on("participant_connected", _on_join)
    try:
        await asyncio.wait_for(future, timeout)
        return future.result()
    except asyncio.TimeoutError:
        logger.warning("timed out waiting for participant", extra={"event": "connection.timeout", "room": room.name})
        return None
    finally:
        if not future.done():
            future.cancel()
        room.off("participant_connected", _on_join)


async def entrypoint(job: JobContext) -> None:
    """Worker entrypoint: one voice session per joining participant."""
    settings = Settings()
    setup_logging(settings.agent_log_level, settings.agent_log_format)
    shared = _get_shared(settings)
    await _ensure_api_task(shared)

    await job.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("worker connected to room", extra={"event": "connection.connected", "room": job.room.name})

    participant = await _wait_for_participant(job.room)
    if participant is None:
        await job.shutdown()
        return

    stt = WhisperClient(shared.settings)
    session = VoiceSession(
        session_id=uuid.uuid4().hex,
        room=job.room,
        participant=participant,
        settings=shared.settings,
        conversations=shared.conversations,
        stt=stt,
        llm=shared.llm,
        tts=shared.tts,
        tools=shared.tools,
        events=EventPublisher(job.room),
    )
    await session.start()

    disconnect = asyncio.get_running_loop().create_future()

    def _on_disconnected(leaver: rtc.RemoteParticipant) -> None:
        if leaver == participant and not disconnect.done():
            disconnect.set_result(leaver)

    job.room.on("participant_disconnected", _on_disconnected)
    try:
        await disconnect
        logger.info("participant disconnected; closing session", extra={"event": "participant.left", "session_id": session.session_id})
    finally:
        job.room.off("participant_disconnected", _on_disconnected)
        await session.close()
        await stt.aclose()


async def prewarm(_proc: Any) -> None:
    """Start the in-process API in the job process before the first job."""
    settings = Settings()
    setup_logging(settings.agent_log_level, settings.agent_log_format)
    shared = _get_shared(settings)
    await _ensure_api_task(shared)


def _start_api_in_thread(settings: Settings) -> None:
    """0.x fallback: run the API in a daemon thread with its own event loop."""

    def _run() -> None:
        asyncio.run(_run_api(_get_shared(settings)))

    threading.Thread(target=_run, name="agent-api", daemon=True).start()


def _build_worker_options(settings: Settings) -> WorkerOptions:
    """WorkerOptions with entrypoint/prewarm kwarg names resolved across livekit-agents versions."""
    params = inspect.signature(WorkerOptions.__init__).parameters
    keyword = "entrypoint" if "entrypoint" in params else "entrypoint_fnc"
    options = {
        keyword: entrypoint,
        "worker_type": WorkerType.ROOM,
        "name": settings.livekit_worker_name,
        "num_idle_processes": 1,  # single job runner -> single in-process API instance
    }
    if "prewarm_fnc" in params:
        options["prewarm_fnc"] = prewarm
    return WorkerOptions(**options)


def main() -> None:
    settings = Settings()
    setup_logging(settings.agent_log_level, settings.agent_log_format)
    if "prewarm_fnc" not in inspect.signature(WorkerOptions.__init__).parameters:
        _start_api_in_thread(settings)
    logger.info(
        "voice agent starting",
        extra={"event": "worker.start", "model": settings.ollama_model, "stt_model": settings.stt_model_size},
    )
    cli.run_app(_build_worker_options(settings))


if __name__ == "__main__":
    main()
