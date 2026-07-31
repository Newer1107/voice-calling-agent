"""Structured logging: one shared logger factory.

Format (``json`` or ``text``) and level come from the environment. Log
records carry structured context via ``extra=`` (e.g. ``session_id``,
``event``); those fields are rendered into the structured output by the
formatter. Stdlib only — no extra dependency.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

# Attributes logging.LogRecord always carries; anything else in
# record.__dict__ is treated as a structured context field.
_STD_RECORD_ATTRS = frozenset(
    {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "taskName",
    }
)

# Third-party loggers quieted unless debug logging is requested.
_NOISY_LOGGERS = ("livekit", "uvicorn", "httpx", "fastapi", "faster_whisper")


class _JsonFormatter(logging.Formatter):
    """One JSON object per line: {ts, level, logger, message, ...fields}."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key in _STD_RECORD_ATTRS or key.startswith("_"):
                continue
            payload[key] = value if isinstance(value, (str, int, float, bool, type(None))) else str(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class _TextFormatter(logging.Formatter):
    """Human-readable lines with structured ``key=value`` fields appended."""

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        fields: list[str] = []
        for key, value in record.__dict__.items():
            if key in _STD_RECORD_ATTRS or key.startswith("_"):
                continue
            rendered = value if isinstance(value, (str, int, float, bool, type(None))) else str(value)
            fields.append(f"{key}={rendered}")
        return f"{base} {' '.join(fields)}".rstrip()


def setup_logging(level: str = "INFO", log_format: str = "json") -> None:
    """Configure the root logger with the structured formatter (idempotent)."""
    root = logging.getLogger()
    root.setLevel(level.upper())

    if log_format == "json":
        formatter: logging.Formatter = _JsonFormatter()
    else:
        formatter = _TextFormatter(fmt="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    root.handlers = [handler]

    quiet = logging.DEBUG if level.upper() == "DEBUG" else logging.WARNING
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(quiet)


def get_logger(name: str) -> logging.Logger:
    """Return a logger inside the ``voice_agent`` namespace.

    Usage: ``logger = get_logger("session")``; pass structured context via
    ``logger.info("user speech", extra={"event": "user_speech", "session_id": id})``.
    """
    return logging.getLogger(f"voice_agent.{name.lstrip('.')}")
