"""Prompt templates for the voice agent.

The system prompt is built once per process (``OLLAMA_SYSTEM_PROMPT`` in
``.env`` overrides the default; it may contain ``{tools_json}`` which is
substituted with the registered tool schemas at first use).
"""

from __future__ import annotations

import json
from typing import Any

DEFAULT_SYSTEM_PROMPT = """\
You are a friendly, concise AI voice assistant embedded in a real-time voice \
conversation. Your responses are spoken aloud, so:

- Keep replies short and natural, like talking to a friend.
- Avoid lists, markdown, emoji, and jargon.
- Use the available tools to look up information or perform actions when \
relevant. Never invent tool results: if a tool call fails, say so plainly \
and suggest a next step.
- If the user asks something you cannot do, say so and offer an alternative.

Available tools: {tools_json}.
"""


def build_system_prompt(settings: Any, tools: list[dict[str, Any]]) -> str:
    """Return the effective system prompt with the tool schemas inlined."""
    configured = settings.ollama_system_prompt
    if configured:
        try:
            return configured.format(tools_json=json.dumps(tools))
        except (KeyError, ValueError):
            return configured
    return DEFAULT_SYSTEM_PROMPT.format(tools_json=json.dumps(tools))
