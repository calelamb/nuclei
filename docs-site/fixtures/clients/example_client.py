#!/usr/bin/env python3
"""Minimal Nuclei kernel client: parse a Bell circuit, run it, print counts.

Usage: python example_client.py [ws://localhost:9742]
Requires: pip install websockets

This file is replay-tested: kernel/tests/test_docs_fixtures.py runs it as a
subprocess against a live kernel server and asserts the histogram output.
"""
import asyncio
import json
import sys

import websockets

BELL = """from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""


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
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:9742"
    sys.exit(asyncio.run(main(url)))
