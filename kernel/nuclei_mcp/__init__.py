"""nuclei-mcp: typed QEC research tools with an immutable research journal.

A stdio MCP server (official ``mcp`` Python SDK) that lets a researcher's own
agent run real QEC research through Nuclei without being able to produce an
untraceable number: every numeric result carries a ``run_id`` and a manifest,
and the same record is appended to a write-once journal.

Independent of the desktop app and of the WebSocket kernel (``kernel.server``);
it imports nothing from them. Entry point: ``python -m nuclei_mcp``.
"""

__version__ = "0.1.0"
