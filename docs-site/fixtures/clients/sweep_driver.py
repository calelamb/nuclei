#!/usr/bin/env python3
"""Batch parameter sweep over the Nuclei hardware API: an RY(theta) curve.

Submits one single-qubit circuit per sweep point through `hardware_submit`
to the local simulator provider, polls each job to completion, and prints a
theta -> P(1) table.

Usage: python sweep_driver.py [ws://localhost:9742] [shots] [points]
Requires: pip install websockets

This file is replay-tested: kernel/tests/test_docs_fixtures.py runs it as a
subprocess against a live kernel server (3 points, 64 shots) and asserts
the table output.
"""
import asyncio
import json
import math
import sys

import websockets

PROVIDER = "simulator"
BACKEND = "sim_qasm"

CIRCUIT_TEMPLATE = """from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.ry({theta}, 0)
qc.measure(0, 0)
"""


async def request(ws, payload: dict, reply_type: str) -> dict:
    """Send one hardware request and wait for its single reply.

    Every hardware request gets exactly one reply: the named response type
    or an `error` envelope — which this raises so the sweep fails loudly.
    """
    await ws.send(json.dumps(payload))
    while True:
        message = json.loads(await ws.recv())
        if message["type"] == "error":
            raise RuntimeError(message["message"])
        if message["type"] == reply_type:
            return message


async def run_point(ws, theta: float, shots: int) -> dict:
    """Submit one circuit and poll until its counts arrive."""
    submitted = await request(ws, {
        "type": "hardware_submit",
        "provider": PROVIDER,
        "backend": BACKEND,
        "shots": shots,
        "code": CIRCUIT_TEMPLATE.format(theta=repr(theta)),
        "language": "python",
    }, "hardware_job_submitted")
    job_id = submitted["job"]["id"]

    # Completion is discovered via hardware_results, NOT hardware_status
    # (status polling only refreshes queue position). The simulator
    # completes synchronously; real providers return {"status": "running"}
    # here until done — hence the loop.
    while True:
        result = await request(ws, {
            "type": "hardware_results", "job_id": job_id,
        }, "hardware_result")
        data = result["data"]
        if "error" in data:
            raise RuntimeError(f"job {job_id} failed: {data['error']}")
        if "measurements" in data:
            return data["measurements"]
        await asyncio.sleep(1.0)


async def main(url: str, shots: int, points: int) -> int:
    step = math.pi / (points - 1) if points > 1 else 0.0
    async with websockets.connect(url) as ws:
        print(f"sweep: RY(theta) on {PROVIDER}/{BACKEND}, {shots} shots/point")
        for i in range(points):
            theta = i * step
            counts = await run_point(ws, theta, shots)
            p1 = counts.get("1", 0) / shots
            print(f"theta={theta:.4f}  P(1)={p1:.4f}  counts={counts}")
    return 0


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "ws://localhost:9742"
    shots = int(sys.argv[2]) if len(sys.argv) > 2 else 256
    points = int(sys.argv[3]) if len(sys.argv) > 3 else 9
    sys.exit(asyncio.run(main(url, shots, points)))
