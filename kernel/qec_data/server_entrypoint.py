"""Process entrypoint for the QEC Data Engine server."""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from .server import HOST, PORT, PortInUseError, QecDataServer
from .protocol import ProtocolError
from .source_security import project_identity_from_environment


TOKEN_ENVIRONMENT_VARIABLE = "NUCLEI_QEC_DATA_TOKEN"
PROJECT_ENVIRONMENT_VARIABLE = "NUCLEI_QEC_DATA_PROJECT_ROOT"


def _arguments(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Nuclei QEC Data Engine")
    parser.add_argument("--port", type=int, default=PORT)
    arguments = parser.parse_args(argv)
    if arguments.port != PORT:
        parser.error(f"QEC Data Engine port must be {PORT}")
    return arguments


async def _main_async(port: int) -> int:
    token = os.environ.get(TOKEN_ENVIRONMENT_VARIABLE)
    project = os.environ.get(PROJECT_ENVIRONMENT_VARIABLE)
    if not token or not project:
        print("NUCLEI_QEC_DATA_ERROR missing_environment", flush=True)
        return 2
    try:
        server = QecDataServer(
            Path(project),
            token,
            port=port,
            expected_project_identity=project_identity_from_environment(),
        )
        await server.start()
    except PortInUseError:
        print("NUCLEI_QEC_DATA_ERROR port_in_use", flush=True)
        return 2
    except ProtocolError as error:
        code = (
            error.code
            if error.code in {"project_identity_changed", "project_identity_unavailable"}
            else "startup_failed"
        )
        print(f"NUCLEI_QEC_DATA_ERROR {code}", flush=True)
        return 2
    except Exception:
        print("NUCLEI_QEC_DATA_ERROR startup_failed", flush=True)
        return 2
    print(f"NUCLEI_QEC_DATA_READY {HOST}:{port}", flush=True)
    await server.serve_forever()
    return 0


def main(argv: list[str] | None = None) -> int:
    arguments = _arguments(argv)
    try:
        return asyncio.run(_main_async(arguments.port))
    except KeyboardInterrupt:
        return 0
