"""Tool-calling component: registry, discovery schemas, and the webhook tool."""

from ..clients.n8n import WebhookToolError
from .manager import Tool, ToolManager, ToolResult
from .webhook_tool import WebhookTool

__all__ = ["Tool", "ToolManager", "ToolResult", "WebhookTool", "WebhookToolError"]
