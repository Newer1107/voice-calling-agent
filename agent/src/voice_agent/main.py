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
from livekit.agents.job import JobExecutorType

from .api import create_app
from .clients.base import LLMClient, STTClient
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
        self.conversations = _get_conversations(settings)
        # 15: STT is intentionally per-session, not shared here
        self.llm: LLMClient = OllamaClient(settings)
        self.tts: KokoroClient = KokoroClient(settings)
        self.tools: ToolManager = ToolManager.from_settings(settings)
        self.hub: Any = None
        self.db: Any = None
        if settings.enable_dashboard:
            from .dashboard import DashboardDB, get_hub

            self.hub = get_hub(settings)
            self.db = DashboardDB(settings)

    async def aclose(self) -> None:
        await asyncio.gather(
            self.llm.aclose(),
            self.tts.aclose(),
            self.tools.aclose(),
            return_exceptions=True,
        )


_shared: SharedServices | None = None
_api_thread_started: bool = False
_conversations: ConversationManager | None = None
_conversations_lock = threading.Lock()


def _get_conversations(settings: Settings) -> ConversationManager:
    """Shared conversation store for the API thread AND session loops.

    Lives outside SharedServices so the FastAPI helper (daemon thread, own
    event loop) and sessions (worker loop) see the same instance; the manager
    is thread-safe via threading.Lock.
    """
    global _conversations
    if _conversations is None:
        with _conversations_lock:
            if _conversations is None:
                _conversations = ConversationManager(settings.session_history_limit)
    return _conversations


def _get_shared(settings: Settings) -> SharedServices:
    global _shared
    if _shared is None:
        _shared = SharedServices(settings)
    return _shared


def _start_api_in_thread(settings: Settings) -> None:
    """Run the FastAPI helper in a daemon thread with its own event loop."""
    global _api_thread_started
    if _api_thread_started or not settings.enable_agent_api:
        return
    _api_thread_started = True
    conversations = _get_conversations(settings)

    def _run() -> None:
        try:
            asyncio.run(_run_api(settings, conversations))
        except OSError as exc:
            # another job process already bound the port; the API is live there
            logger.warning("agent API bind skipped", extra={"event": "api.bind_skipped", "error": str(exc)})

    threading.Thread(target=_run, name="agent-api", daemon=True).start()


async def _run_api(settings: Settings, conversations: ConversationManager) -> None:
    import uvicorn

    hub = db = None
    if settings.enable_dashboard:
        from .dashboard import DashboardDB, get_hub

        hub = get_hub(settings)
        db = DashboardDB(settings)
    app = create_app(settings, conversations, hub, db)
    config = uvicorn.Config(
        app,
        host=settings.agent_host,
        port=settings.agent_port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    logger.info(
        "agent API starting",
        extra={"event": "api.start", "host": settings.agent_host, "port": settings.agent_port},
    )
    try:
        await server.serve()
    except asyncio.CancelledError:
        logger.info("agent API stopped", extra={"event": "api.stop"})
        raise


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


def _ensure_deepgram_registered(settings: Settings) -> None:
    """Import the deepgram plugin on the MAIN thread.

    livekit.plugins.deepgram registers itself at module import time
    (Plugin.register_plugin), which raises unless called from the main
    thread. Jobs run on worker threads (JobExecutorType.THREAD), so the
    import must happen here, before any job starts; the client's own import
    is then a cached no-op.
    """
    if settings.stt_provider == "deepgram":
        from livekit.plugins import deepgram  # noqa: F401


def _build_stt(settings: Settings) -> STTClient:
    """Return the STT backend selected by STT_PROVIDER.

    The deepgram import is lazy so a whisper-only install (plugin not
    installed) still boots; the plugin package is only imported when the
    provider is actually selected.
    """
    if settings.stt_provider == "deepgram":
        if not settings.deepgram_api_key:
            raise RuntimeError("STT_PROVIDER=deepgram requires DEEPGRAM_API_KEY in agent/.env")
        from .clients.deepgram import DeepgramClient

        return DeepgramClient(settings)
    return WhisperClient(settings)


async def entrypoint(job: JobContext) -> None:
    """Worker entrypoint: one voice session per joining participant."""
    settings = Settings()
    setup_logging(settings.agent_log_level, settings.agent_log_format)
    shared = _get_shared(settings)

    await job.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("worker connected to room", extra={"event": "connection.connected", "room": job.room.name})

    participant = await _wait_for_participant(job.room)
    if participant is None:
        job.shutdown()
        return

    stt = _build_stt(shared.settings)
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
        hub=shared.hub,
        db=shared.db,
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


async def prewarm_async(_proc: Any) -> None:
    """0.x async prewarm hook: start the in-process API before the first job."""
    settings = Settings()
    setup_logging(settings.agent_log_level, settings.agent_log_format)
    _ensure_deepgram_registered(settings)
    _start_api_in_thread(settings)
    if settings.stt_provider != "deepgram":
        _warm_stt_in_thread(settings)


def prewarm(_proc: Any) -> None:
    """1.6+ sync prewarm hook: livekit-agents calls this WITHOUT awaiting.

    The FastAPI helper runs in a daemon thread with its own event loop (the
    job process's main loop serves sessions; the API thread serves HTTP). The
    ConversationManager is thread-safe (threading.Lock) so both can share it.
    """
    settings = Settings()
    setup_logging(settings.agent_log_level, settings.agent_log_format)
    _ensure_deepgram_registered(settings)
    _start_api_in_thread(settings)
    if settings.stt_provider != "deepgram":
        _warm_stt_in_thread(settings)


def _warm_stt_in_thread(settings: Settings) -> None:
    """Load the Whisper model in the background so the first session hears
    speech immediately instead of blocking on model load."""
    import threading

    from .clients.whisper import warmup_stt

    threading.Thread(target=warmup_stt, args=(settings,), daemon=True).start()


def _build_worker_options(settings: Settings) -> WorkerOptions:
    """WorkerOptions with kwarg names resolved across livekit-agents versions."""
    params = inspect.signature(WorkerOptions.__init__).parameters
    entrypoint_kw = "entrypoint" if "entrypoint" in params else "entrypoint_fnc"
    # livekit-agents 1.6+ renamed the worker-name kwarg to agent_name.
    name_kw = "agent_name" if "agent_name" in params else "name"
    options = {
        entrypoint_kw: entrypoint,
        "worker_type": WorkerType.ROOM,
        name_kw: settings.livekit_worker_name,
        # THREAD executor: jobs run in-process so the ConversationManager and
        # the single API instance are shared across all sessions (PROC would
        # fork per-job processes, breaking /history and double-binding :8090).
        "job_executor_type": JobExecutorType.THREAD,
        "ws_url": settings.livekit_url,
        "api_key": settings.livekit_api_key,
        "api_secret": settings.livekit_api_secret,
    }
    if "prewarm_fnc" in params:
        options["prewarm_fnc"] = prewarm
    return WorkerOptions(**options)


def main() -> None:
    settings = Settings()
    setup_logging(settings.agent_log_level, settings.agent_log_format)
    _ensure_deepgram_registered(settings)
    if "prewarm_fnc" not in inspect.signature(WorkerOptions.__init__).parameters:
        _start_api_in_thread(settings)
    logger.info(
        "voice agent starting",
        extra={
            "event": "worker.start",
            "model": settings.ollama_model,
            "stt_provider": settings.stt_provider,
        },
    )
    cli.run_app(_build_worker_options(settings))


if __name__ == "__main__":
    main()
