"""``python -m nuclei_mcp [--journal DIR] [--ceiling-NAME N ...]`` (stdio)."""

from __future__ import annotations

import argparse
from pathlib import Path

from .ceilings import Ceilings
from .server import build_server


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="nuclei_mcp", description="Nuclei QEC research MCP server (stdio).")
    parser.add_argument("--journal", type=Path, default=None, help="journal directory (default: ~/.nuclei/mcp-journal or $NUCLEI_MCP_JOURNAL)")
    for name, field in Ceilings.model_fields.items():
        kind = float if field.annotation is float else int
        parser.add_argument(f"--ceiling-{name.replace('_', '-')}", dest=f"ceiling_{name}", type=kind, default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    overrides = {n: getattr(args, f"ceiling_{n}") for n in Ceilings.model_fields}
    ceilings = Ceilings.from_env().with_overrides(overrides)
    build_server(args.journal, ceilings).run("stdio")


if __name__ == "__main__":
    main()
