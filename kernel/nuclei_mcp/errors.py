"""Error types surfaced to the calling agent as MCP tool errors.

Subclassing the SDK's ToolError is what makes the SDK return the message to
the agent (is_error result) instead of hiding it as a server crash.
"""

from __future__ import annotations

from mcp.server.mcpserver.exceptions import ToolError


class ToolInputError(ToolError, ValueError):
    """The request was invalid; the message is safe to show verbatim."""


class CeilingExceeded(ToolInputError):
    """A request exceeded a configured hard ceiling and was refused."""


class JournalError(ToolError, RuntimeError):
    """Journal violation: duplicate write, missing record, or integrity failure."""
