"""One voice session: audio in -> STT -> LLM(+tools) -> TTS -> audio out.

Pipeline orchestration for a single browser participant. Failures in any
component (STT, LLM, TTS, tools) are caught here, published as ``error``
events (stt_failed / llm_failed / tts_failed / tool_failed / internal) and
never kill the session — only :meth:`VoiceSession.close` (e.g. participant
disconnect) ends it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from collections import deque
from typing import Any

import livekit.rtc as rtc
import numpy as np

from ..clients.base import (
    LLMClient,
    LLMError,
    LLMTextDelta,
    SpeechEvent,
    STTClient,
    ToolCall,
    TTSClient,
)
from ..clients.kokoro import decode_wav
from ..config import Settings
from ..events import ClientMessage, EventPublisher
from ..logging_config import get_logger
from ..tools.manager import ToolManager, ToolResult
from .conversation import ConversationManager, ConversationMessage

logger = get_logger("session")


def _now_iso() -> str:
    """ISO-8601 UTC timestamp for dashboard events."""
    import datetime as _dt

    return _dt.datetime.now(_dt.timezone.utc).isoformat()

WELCOME_MESSAGE = (
    "Hello, and welcome to IronPeak Fitness! I'm Maya, your receptionist. "
    "May I have your name, please?"
)
MAX_TOOL_ROUNDS = 3              # tool-call rounds before the model must answer plainly
TTS_TARGET_SAMPLE_RATE = 24000   # Kokoro native rate; all clips resampled to it
FRAME_CHUNK_MS = 40              # output frames pushed at 40ms granularity
# Sentence delimiters for sentence-streamed TTS (trailing whitespace consumed).
_SENTENCE_END = re.compile(r"[.!?…]\s*")
# Markdown/formatting leaks (**, bullets, backticks) must never reach the
# transcript or the TTS — they'd be read aloud as gibberish.
_MARKDOWN = re.compile(r"[\*`]|^\s*(?:[-•]|#+)\s*|\{[^{}]*\}", re.MULTILINE)


def sanitize_spoken_text(text: str) -> str:
    """Strip markdown/formatting symbols so replies stay plain conversational text."""
    text = _MARKDOWN.sub("", text)
    # U+FFFD: the model occasionally renders £/₹ as a broken replacement char.
    return text.replace("\ufffd", "").strip()


def tool_calls_to_wire(tool_calls: list[ToolCall]) -> list[dict[str, Any]]:
    """Serialize ToolCall objects into the OpenAI wire shape for history."""
    return [
        {
            "id": call.id,
            "type": "function",
            "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
        }
        for call in tool_calls
    ]


def pcm16_to_frames(pcm16: bytes, sample_rate: int, channels: int) -> list[rtc.AudioFrame]:
    """Split WAV PCM16 into mono 40ms frames at TTS_TARGET_SAMPLE_RATE."""
    samples = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    if sample_rate != TTS_TARGET_SAMPLE_RATE:
        n_out = int(len(samples) * TTS_TARGET_SAMPLE_RATE / sample_rate)
        samples = np.interp(np.linspace(0, len(samples) - 1, n_out), np.arange(len(samples)), samples)
    pcm = samples.astype(np.int16).tobytes()
    chunk = int(TTS_TARGET_SAMPLE_RATE * FRAME_CHUNK_MS / 1000)
    frames: list[rtc.AudioFrame] = []
    for offset in range(0, len(pcm), chunk * 2):
        frame_bytes = pcm[offset : offset + chunk * 2]
        if len(frame_bytes) < chunk * 2:
            frame_bytes = frame_bytes + b"\x00" * (chunk * 2 - len(frame_bytes))
        frames.append(
            rtc.AudioFrame(
                data=frame_bytes,
                sample_rate=TTS_TARGET_SAMPLE_RATE,
                num_channels=1,
                samples_per_channel=chunk,
            )
        )
    return frames


class VoiceSession:
    """Owns one participant's end-to-end voice pipeline."""

    def __init__(
        self,
        *,
        session_id: str,
        room: rtc.Room,
        participant: rtc.RemoteParticipant,
        settings: Settings,
        conversations: ConversationManager,
        stt: STTClient,
        llm: LLMClient,
        tts: TTSClient,
        tools: ToolManager,
        events: EventPublisher,
        hub: Any | None = None,
        db: Any | None = None,
    ) -> None:
        self.session_id = session_id
        self._room = room
        self._participant = participant
        self._settings = settings
        self._conversations = conversations
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._tools = tools
        self._events = events
        self._hub = hub
        self._db = db

        self._tasks: set[asyncio.Task] = set()
        self._turn_lock = asyncio.Lock()
        self._play_lock = asyncio.Lock()  # serializes TTS playback across concurrent turns
        self._pending_finals: deque[str] = deque()
        self._sentence_buf: list[str] = []
        # The in-flight agent turn runs as its own task so an interrupt can
        # cancel it; the TTS player is tracked separately because stopping the
        # audio must happen before (and independently of) cancelling the LLM.
        self._turn_task: asyncio.Task | None = None
        self._tts_task: asyncio.Task | None = None
        self._speaking = False
        self._closed = False
        self._ptt_active = False
        self._vad_enabled = settings.vad_enabled
        self._audio_source: rtc.AudioSource | None = None
        self._started_at: float | None = None
        self._message_count = 0
        self._any_tool_failed = False
        self._last_reply: str | None = None

    # -- dashboard events ----------------------------------------------------
    def _emit(self, type_: str, data: dict[str, Any]) -> None:
        if self._hub is not None:
            self._hub.publish(type_, data)

    async def _persist(self, factory: Any) -> None:
        if self._db is None:
            return
        try:
            await factory()
        except Exception as exc:
            logger.warning("dashboard persist failed", extra={"event": "dashboard.persist_failed", "error": str(exc)})

    # -- lifecycle -----------------------------------------------------------
    async def start(self) -> None:
        """Open the session: announce, capture input, listen for client messages."""
        await self._events.state_connected(self.session_id)
        await self._events.welcome(self.session_id, WELCOME_MESSAGE)
        self._started_at = time.monotonic()
        self._emit("conversation.started", {"conversationId": self.session_id, "startedAt": _now_iso()})
        await self._persist(lambda: self._db.conversation_started(self.session_id))
        # Not actually listening until PTT is held (or VAD is on) — report the real gate.
        await self._events.state_listening(
            self.session_id,
            active=bool(self._vad_enabled),
            source="vad" if self._vad_enabled else "ptt",
        )
        self._events.start_listening()
        self._spawn(self._input_loop())
        self._spawn(self._inbound_loop())
        logger.info("session started", extra={"event": "session.started", "session_id": self.session_id})

    async def close(self) -> None:
        """Stop all pipeline tasks and release the session (idempotent)."""
        if self._closed:
            return
        self._closed = True
        self._events.stop_listening()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        if self._started_at is not None:
            duration = int(time.monotonic() - self._started_at)
            self._emit("conversation.finished", {
                "conversationId": self.session_id,
                "durationSec": duration,
                "messageCount": self._message_count,
                "outcome": "failed" if self._any_tool_failed else "ok",
                "summary": self._last_reply,
            })
            await self._persist(lambda: self._db.conversation_finished(
                self.session_id,
                duration,
                self._message_count,
                "failed" if self._any_tool_failed else "ok",
                self._last_reply,
            ))
        await self._send_confirmation_email()
        await self._conversations.close(self.session_id)
        logger.info("session closed", extra={"event": "session.closed", "session_id": self.session_id})

    async def _send_confirmation_email(self) -> None:
        """Auto-send a booking/order confirmation after the call, if any were made.

        Reads the member email + records created during this conversation from
        the dashboard DB and fires the existing sendEmail tool. Best effort: any
        failure is logged, never raised (the session is already closing).
        """
        if self._db is None or self._tools is None:
            return
        try:
            info = await self._db.confirmation_for(self.session_id)
        except Exception as exc:
            logger.warning("confirmation lookup failed", extra={"event": "email.confirm_failed", "session_id": self.session_id, "error": str(exc)})
            return
        if info is None:
            return
        lines: list[str] = [f"Hi {info['member']}, thanks for calling IronPeak Fitness!"]
        for appointment in info["appointments"]:
            lines.append(
                f"- {appointment['session']} on {appointment['date']} at {appointment['time']} "
                f"(booking {appointment['bookingId']}, {appointment['status']})"
            )
        for order in info["orders"]:
            items = ", ".join(
                f"{item.get('quantity', 1)}x {item.get('name', 'item')}"
                for item in (order.get("items") or [])
            )
            lines.append(f"- Order {order['orderId']} ({order['status']}): {items}")
        body = "\n".join(lines)
        try:
            result = await self._tools.execute(
                "sendEmail",
                {"to": info["email"], "subject": "Your IronPeak Fitness confirmation", "body": body},
                self.session_id,
            )
            logger.info(
                "confirmation email sent",
                extra={"event": "email.sent", "session_id": self.session_id, "to": info["email"], "ok": result.ok},
            )
        except Exception as exc:
            logger.warning("confirmation email failed", extra={"event": "email.confirm_failed", "session_id": self.session_id, "error": str(exc)})

    def _spawn(self, coroutine: Any) -> None:
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # -- audio input ---------------------------------------------------------
    async def _input_loop(self) -> None:
        try:
            track = await self._wait_for_audio_track()
            stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)  # whisper expects 16 kHz mono
            logger.info("audio input stream started", extra={"event": "input.started", "session_id": self.session_id})
            async for event in stream:
                if self._closed:
                    break
                if not (self._ptt_active or self._vad_enabled):
                    continue
                for speech in await self._stt.push(event.frame):
                    await self._on_speech(speech)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("audio input failed", extra={"event": "stt_stream_failed", "session_id": self.session_id, "error": str(exc)})
            await self._events.error(self.session_id, "stt_failed", f"audio input error: {exc}", recoverable=True)

    async def _wait_for_audio_track(self, timeout: float = 10.0) -> rtc.RemoteAudioTrack:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            for publication in self._participant.track_publications.values():
                if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.track is not None:
                    return publication.track  # type: ignore[return-value]
            await asyncio.sleep(0.1)
        raise RuntimeError("participant published no audio track")

    async def _on_speech(self, speech: SpeechEvent) -> None:
        if self._closed:
            return
        if speech.kind == "started":
            # Barge in only while the agent is audibly talking. Speech that
            # starts while it is thinking queues after the current turn instead
            # of cancelling it — otherwise a pause mid-utterance ("book me…
            # …a massage") fragments one request into two turns.
            if self._speaking:
                await self._interrupt()
            return
        if speech.kind == "partial":
            await self._events.transcript_partial(self.session_id, speech.text)
            return
        await self._events.transcript_final(self.session_id, speech.text, confidence=speech.confidence, language=speech.language)
        logger.info("user speech", extra={"event": "user_speech", "session_id": self.session_id, "text": speech.text})
        self._handle_final(speech.text)

    def _handle_final(self, text: str) -> None:
        """Start one agent turn as a task; queue input while a turn runs.

        Turns are detached so an interrupt can cancel them and the input /
        inbound loops never block on playback.
        """
        if self._closed:
            return
        if self._turn_lock.locked() or self._turn_task is not None:
            self._pending_finals.append(text)
            logger.debug("queued input during agent turn", extra={"event": "input.queued", "session_id": self.session_id})
            return
        self._turn_task = asyncio.create_task(self._handle_turn(text))

    # -- agent turn ----------------------------------------------------------
    async def _handle_turn(self, text: str) -> None:
        """Run one turn, then drain anything queued while it held the lock."""
        try:
            await self._run_turn(text)
            while self._pending_finals and not self._closed:
                await self._run_turn(self._pending_finals.popleft())
        finally:
            self._turn_task = None

    async def _interrupt(self) -> None:
        """Barge in: stop the in-flight turn so the user's new input wins.

        Order matters: kill the TTS player first (silence now), flush any
        frames already queued in the audio source, then cancel the LLM/tool
        turn. Anything the user says after this starts a fresh turn.
        """
        if self._tts_task is not None and not self._tts_task.done():
            self._tts_task.cancel()
            await asyncio.gather(self._tts_task, return_exceptions=True)
            self._tts_task = None
        if self._audio_source is not None:
            try:
                self._audio_source.clear_queue()
            except Exception:
                pass
        if self._turn_task is not None and not self._turn_task.done():
            self._turn_task.cancel()
            await asyncio.gather(self._turn_task, return_exceptions=True)
        self._pending_finals.clear()
        await self._events.state_speaking(self.session_id, active=False)
        # A final that landed while the old turn was unwinding must still run.
        if self._pending_finals and not self._closed:
            self._turn_task = asyncio.create_task(self._handle_turn(self._pending_finals.popleft()))

    async def _run_turn(self, text: str) -> None:
        """One agent turn: think under the lock; TTS plays inside _agent_loop."""
        async with self._turn_lock:
            await self._events.state_thinking(self.session_id, active=True)
            await self._events.state_listening(self.session_id, active=False)
            await self._conversations.add_message(self.session_id, ConversationMessage(role="user", content=text))
            self._message_count += 1
            self._emit("transcript.updated", {"conversationId": self.session_id, "role": "user", "text": text, "ts": _now_iso()})
            await self._persist(lambda: self._db.conversation_message(self.session_id, "user", text))
            try:
                await self._agent_loop()
            except LLMError as exc:
                logger.error("llm failed", extra={"event": "llm_failed", "session_id": self.session_id, "error": str(exc)})
                await self._events.error(self.session_id, "llm_failed", str(exc), recoverable=True)
            except Exception as exc:
                logger.error("turn failed", extra={"event": "turn_failed", "session_id": self.session_id, "error": str(exc)})
                await self._events.error(self.session_id, "internal", f"agent turn failed: {exc}", recoverable=True)
            finally:
                if not self._closed:
                    await self._events.state_thinking(self.session_id, active=False)
        if not self._closed:
            active = self._ptt_active or self._vad_enabled
            source = "ptt" if self._ptt_active else ("vad" if self._vad_enabled else "ptt")
            await self._events.state_listening(self.session_id, active=active, source=source)

    async def _agent_loop(self) -> str | None:
        """LLM with tool calling; returns the assistant's final text (or None).

        Tool-capable rounds use the non-streaming completion so a tool call
        the model writes as JSON text is converted (clients/ollama.py) and
        executed instead of spoken. The final answer streams, and complete
        sentences are spoken as they arrive (sentence-streamed TTS) so audio
        starts before the model finishes.
        """
        history = await self._conversations.history_for_llm(self.session_id)
        message_id = uuid.uuid4().hex
        parts: list[str] = []
        emitted = False

        async def on_delta(delta: str) -> None:
            nonlocal emitted
            parts.append(delta)
            if not emitted:
                emitted = True
                await self._events.message_start(self.session_id, message_id)
            await self._events.message_delta(self.session_id, message_id, delta)

        tts_queue: asyncio.Queue[str | None] = asyncio.Queue()
        tts_task = asyncio.create_task(self._tts_player(tts_queue))
        self._tts_task = tts_task

        async def on_final_delta(delta: str) -> None:
            delta = sanitize_spoken_text(delta)
            if not delta:
                return
            await on_delta(delta)
            await self._queue_sentences(tts_queue, delta)

        final_text: str | None = None
        try:
            for _ in range(MAX_TOOL_ROUNDS):
                response = await self._llm.complete(history, tools=self._tools.schemas())
                if not response.tool_calls:
                    if response.content:
                        await on_final_delta(response.content)
                    break
                await self._conversations.add_message(
                    self.session_id,
                    ConversationMessage(role="assistant", content="", tool_calls=tool_calls_to_wire(response.tool_calls)),
                )
                history.append({"role": "assistant", "content": "", "tool_calls": tool_calls_to_wire(response.tool_calls)})
                for call in response.tool_calls:
                    summary = await self._execute_tool(call)
                    history.append({"role": "tool", "tool_call_id": call.id, "content": summary})
            else:
                # Cap reached with tool calls only: force a plain-text answer.
                if not emitted:
                    async for event in self._llm.stream(history, tools=None):
                        if isinstance(event, LLMTextDelta):
                            await on_final_delta(event.text)
        finally:
            if not tts_task.done():
                try:
                    await tts_queue.put(None)
                except Exception:
                    pass
                await asyncio.gather(tts_task, return_exceptions=True)
            self._tts_task = None
            # Persist inside the finally: a barge-in cancels the turn task while
            # TTS plays, and the pre-finally location would skip the DB write,
            # losing a reply that WAS spoken. The final text is fully assembled
            # in `parts` by now, so record it even if playback was cut short.
            if emitted:
                text = sanitize_spoken_text("".join(parts))
                self._last_reply = text
                self._message_count += 1
                self._emit("transcript.updated", {"conversationId": self.session_id, "role": "assistant", "text": text, "ts": _now_iso()})
                await self._persist(lambda: self._db.conversation_message(self.session_id, "assistant", text))
                await self._events.message_done(self.session_id, message_id, text)
                if text:
                    await self._conversations.add_message(self.session_id, ConversationMessage(role="assistant", content=text))
                final_text = text or None

        return final_text

    async def _queue_sentences(self, tts_queue: asyncio.Queue[str | None], delta: str) -> None:
        """Split incoming text into sentences and queue them for TTS playback."""
        self._sentence_buf.append(delta)
        while True:
            joined = "".join(self._sentence_buf)
            match = _SENTENCE_END.search(joined)
            if match is None:
                break
            index = match.end()
            sentence = sanitize_spoken_text(joined[:index])
            self._sentence_buf = [joined[index:]]
            if sentence:
                await tts_queue.put(sentence)

    async def _tts_player(self, tts_queue: asyncio.Queue[str | None]) -> None:
        """Consume sentences and speak them in order (None = stop)."""
        while True:
            sentence = await tts_queue.get()
            if sentence is None:
                return
            await self._speak(sentence)

    async def _execute_tool(self, call: ToolCall) -> str:
        """Execute one tool call; publish result/error events; return the LLM-facing summary."""
        if call.arguments_parse_error:
            logger.warning("tool arguments unparseable", extra={"event": "tool_failed", "session_id": self.session_id, "tool": call.name, "error": call.arguments_parse_error})
            await self._events.tool_error(self.session_id, call.name, call.arguments_parse_error)
            await self._events.error(self.session_id, "tool_failed", f"{call.name}: {call.arguments_parse_error}", recoverable=True)
            return f"Tool {call.name} failed: {call.arguments_parse_error}"
        await self._events.tool_call(self.session_id, call.name, call.arguments)
        self._emit("tool.started", {"conversationId": self.session_id, "tool": call.name, "args": call.arguments, "ts": _now_iso()})
        started = time.monotonic()
        try:
            result = await self._tools.execute(call.name, call.arguments, self.session_id)
        except Exception as exc:
            duration_ms = int((time.monotonic() - started) * 1000)
            self._any_tool_failed = True
            self._emit("tool.finished", {"conversationId": self.session_id, "tool": call.name, "ok": False, "durationMs": duration_ms})
            await self._persist(lambda: self._db.tool_executed(self.session_id, call.name, call.arguments, False, duration_ms))
            logger.error("tool execution failed", extra={"event": "tool_failed", "session_id": self.session_id, "tool": call.name, "error": str(exc)})
            await self._events.tool_error(self.session_id, call.name, str(exc))
            await self._events.error(self.session_id, "tool_failed", f"{call.name}: {exc}", recoverable=True)
            return f"Tool {call.name} failed: {exc}"
        duration_ms = int((time.monotonic() - started) * 1000)
        if result.ok:
            self._emit("tool.finished", {"conversationId": self.session_id, "tool": call.name, "ok": True, "durationMs": duration_ms})
            await self._persist(lambda: self._db.tool_executed(self.session_id, call.name, call.arguments, True, duration_ms))
            await self._emit_domain_events(call.name, result)
            logger.info("tool result", extra={"event": "tool_response", "session_id": self.session_id, "tool": call.name, "ok": True})
            await self._events.tool_result(self.session_id, call.name, ok=True, summary=result.summary, data=result.data)
            return result.summary
        self._any_tool_failed = True
        self._emit("tool.finished", {"conversationId": self.session_id, "tool": call.name, "ok": False, "durationMs": duration_ms})
        await self._persist(lambda: self._db.tool_executed(self.session_id, call.name, call.arguments, False, duration_ms))
        logger.warning("tool result failed", extra={"event": "tool_response", "session_id": self.session_id, "tool": call.name, "ok": False, "error": result.error})
        await self._events.tool_result(self.session_id, call.name, ok=False, summary=result.error or "tool failed")
        return result.error or f"Tool {call.name} failed"

    async def _emit_domain_events(self, tool: str, result: ToolResult) -> None:
        """Translate a successful tool result into dashboard domain events."""
        data = (result.data or {}).get("data") or {}
        if tool in ("bookAppointment", "bookSpaAppointment"):
            payload = {
                "conversationId": self.session_id,
                "bookingId": data.get("bookingId") or "",
                "customer": data.get("member") or data.get("customer") or "",
                "session": data.get("session") or "",
                "date": data.get("date") or "",
                "time": data.get("time") or "",
                "status": data.get("status") or "confirmed",
            }
            self._emit("appointment.created", payload)
            await self._persist(lambda: self._db.appointment_created(self.session_id, data))
        elif tool == "createOrder":
            payload = {
                "conversationId": self.session_id,
                "orderId": data.get("orderId") or "",
                "customer": data.get("member") or data.get("customer") or "",
                "items": data.get("items") or [],
                "status": data.get("status") or "processing",
                "total": data.get("total") or "",
            }
            self._emit("order.created", payload)
            await self._persist(lambda: self._db.order_created(self.session_id, data))
        elif tool == "lookupCustomer":
            profile = {
                "name": data.get("name") or "",
                "tier": data.get("tier") or "Member",
                "membershipStatus": data.get("membershipStatus") or "active",
                "visitsThisMonth": data.get("visitsThisMonth") or 0,
                "upcomingBookings": data.get("upcomingBookings") or [],
            }
            self._emit("customer.loaded", {"conversationId": self.session_id, "customer": profile})
            await self._persist(lambda: self._db.customer_loaded(self.session_id, data))
            name = data.get("name") or ""
            if name:
                await self._persist(lambda: self._db.conversation_customer(self.session_id, name))

    # -- TTS / audio output --------------------------------------------------
    async def _speak(self, text: str) -> None:
        self._speaking = True
        await self._events.state_speaking(self.session_id, active=True)
        try:
            audio = await self._tts.synthesize(text)
            if not audio:
                raise RuntimeError("empty synthesis")
            await self._play_audio(audio)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("tts failed", extra={"event": "tts_failed", "session_id": self.session_id, "error": str(exc)})
            await self._events.error(self.session_id, "tts_failed", f"speech synthesis failed: {exc}", recoverable=True)
        finally:
            self._speaking = False
            if not self._closed:
                await self._events.state_speaking(self.session_id, active=False)

    async def _play_audio(self, audio_bytes: bytes) -> None:
        pcm16, sample_rate, channels = decode_wav(audio_bytes)
        frames = pcm16_to_frames(pcm16, sample_rate, channels)
        if not frames:
            return
        async with self._play_lock:
            if self._audio_source is None:
                await self._publish_audio_track()
            assert self._audio_source is not None
            for frame in frames:
                await self._audio_source.capture_frame(frame)

    async def _publish_audio_track(self) -> None:
        self._audio_source = rtc.AudioSource(TTS_TARGET_SAMPLE_RATE, 1)
        track = rtc.LocalAudioTrack.create_audio_track("voice-agent-output", self._audio_source)
        await self._room.local_participant.publish_track(
            track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        logger.info("audio output track published", extra={"event": "output.published", "session_id": self.session_id})

    # -- inbound client messages ---------------------------------------------
    async def _inbound_loop(self) -> None:
        try:
            async for message in self._events.messages():
                try:
                    await self._on_client_message(message)
                except Exception as exc:
                    # 18: one bad message must never kill the whole loop
                    logger.warning("client message failed", extra={"event": "inbound_failed", "session_id": self.session_id, "error": str(exc)})
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("inbound message handler failed", extra={"event": "inbound_failed", "session_id": self.session_id, "error": str(exc)})

    async def _on_client_message(self, message: ClientMessage) -> None:
        if message.type == "client.ptt.start":
            self._ptt_active = True
            await self._interrupt()
            await self._events.state_listening(self.session_id, active=True, source="ptt")
        elif message.type == "client.ptt.stop":
            was_active = self._ptt_active
            self._ptt_active = False
            if was_active:
                # Release the listening state immediately — flush transcribes
                # the hold and can take a second or two.
                await self._events.state_listening(self.session_id, active=False)
                for speech in await self._stt.flush():
                    await self._on_speech(speech)
                await self._events.state_listening(self.session_id, active=self._vad_enabled, source="vad" if self._vad_enabled else "ptt")
        elif message.type == "client.config":
            payload = message.payload or {}
            if "vadEnabled" in payload:
                self._vad_enabled = bool(payload["vadEnabled"])
                self._stt.endpoint_on_silence = self._vad_enabled
            if "language" in payload:
                language = payload.get("language")
                self._stt.language_override = language or None
            logger.info("client config applied", extra={"event": "client.config", "session_id": self.session_id, "vad_enabled": self._vad_enabled})
