#!/usr/bin/env python3
"""Minimal Nuclei kernel client: parse a Bell circuit, run it, print counts.

Usage: python example_client.py [ws://localhost:9742]
Requires: pip install websockets
Auth: reads the token from $NUCLEI_KERNEL_TOKEN or ~/.nuclei/runtime/kernel-<port>.json

This file is replay-tested: kernel/tests/test_docs_fixtures.py runs it as a
subprocess against a live kernel server and asserts the histogram output.
"""
import asyncio
import hashlib
import hmac
import json
import secrets
import os
import sys
from urllib.parse import urlparse

import websockets

BELL = """from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""


def _port_of(url: str | None) -> int | None:
    """Port of a ws:// URL, or None when it has none."""
    if not url:
        return None
    return urlparse(url).port


def _runtime_info(port: int | None = None) -> dict:
    """Live runtime-file contents ({} if absent, unreadable or stale).

    With a port, prefers that kernel's own kernel-<port>.json (several kernels
    can run at once); kernel.json is the newest-kernel pointer.
    """
    runtime_dir = os.environ.get("NUCLEI_RUNTIME_DIR") or os.path.join(
        os.path.expanduser("~"), ".nuclei", "runtime"
    )
    names = ([f"kernel-{port}.json"] if port else []) + ["kernel.json"]
    for name in names:
        try:
            with open(os.path.join(runtime_dir, name)) as handle:
                info = json.load(handle)
            if port and info.get("port") != port:
                continue  # never use another kernel's token
            os.kill(int(info["pid"]), 0)  # raises if that kernel is gone
            return info
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return {}


def default_url() -> str:
    """The newest kernel the runtime pointer describes (its token matches that port)."""
    return _runtime_info().get("url") or "ws://localhost:9742"


def load_token(url: str | None = None) -> str:
    """Token for this kernel launch: $NUCLEI_KERNEL_TOKEN, else the user-only
    runtime file the kernel writes at startup (like a Jupyter runtime file)."""
    token = os.environ.get("NUCLEI_KERNEL_TOKEN")
    if token:
        return token
    info = _runtime_info(_port_of(url))
    if "token" not in info:
        raise RuntimeError(
            "no token: set NUCLEI_KERNEL_TOKEN or start a kernel (runtime file missing or stale)"
        )
    return info["token"]


async def authenticate(ws, url: str | None = None) -> None:
    """First frame on every connection: present the token and a random nonce,
    then check the kernel's proof (HMAC-SHA256(token, nonce)) in the ack."""
    token = load_token(url)
    nonce = secrets.token_hex(32)
    await ws.send(json.dumps({"type": "authenticate", "token": token, "nonce": nonce}))
    reply = json.loads(await ws.recv())
    if reply.get("type") != "authenticated":
        raise RuntimeError("kernel rejected the authentication token")
    expected = hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(reply.get("proof", "")), expected):
        raise RuntimeError("peer did not prove it is the Nuclei kernel; refusing to continue")


async def drain_until(ws, terminal_type: str) -> dict:
    """Read messages until `terminal_type` arrives, relaying streamed text.

    Every request produces an ordered SEQUENCE of messages — output/stderr
    may interleave before the terminal message, so a robust client loops.
    """
    while True:
        message = json.loads(await ws.recv())
        if message["type"] == "output":
            print(message["text"], end="")
        elif message["type"] == "stderr":
            print(message["text"], end="", file=sys.stderr)
        elif message["type"] == "error":
            print(f"kernel error: {message['message']}", file=sys.stderr)
        if message["type"] == terminal_type:
            return message


async def main(url: str) -> int:
    async with websockets.connect(url) as ws:
        await authenticate(ws, url)
        await ws.send(json.dumps({"type": "parse", "code": BELL, "language": "python"}))
        snapshot = await drain_until(ws, "snapshot")
        if snapshot["data"] is None:
            return 1
        print(f"circuit: {len(snapshot['data']['gates'])} gates, "
              f"depth {snapshot['data']['depth']}")

        await ws.send(json.dumps(
            {"type": "execute", "code": BELL, "shots": 512, "language": "python"}
        ))
        result = await drain_until(ws, "result")
        if result["data"] is None:  # an error message already explained why
            return 1
        for bitstring, count in sorted(result["data"]["measurements"].items()):
            print(f"{bitstring}: {count}")
    return 0


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else default_url()
    sys.exit(asyncio.run(main(url)))
