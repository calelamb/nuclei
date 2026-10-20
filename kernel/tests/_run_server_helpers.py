"""Helpers for tests that drive a real kernel process (``_kernel_client``) through the run-worker routes."""

from __future__ import annotations

import asyncio
import os
import sys
import time
from typing import Any

import pytest

from kernel.tests._kernel_client import Kernel, connect, drain, exchange

BELL = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n"
SPIN = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1, 1)\nwhile True:\n    pass\n"


def start_kernel(env: dict[str, str | None] | None = None, display: str | None = None, launch: str | None = None) -> Kernel:
    kernel = Kernel(sys.executable, env=env, display=display, launch=launch)
    kernel.start()
    return kernel


def warm_up(kernel: Kernel, timeout: float = 90.0) -> None:
    """Block until the kernel's preview worker and one run spare have finished importing."""
    async def go() -> None:
        ws = await connect(kernel)
        try:
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                frames, secs = await exchange(ws, {"type": "execute", "run_id": "warm", "code": BELL, "language": "python"}, {"result"}, 60)
                timing = next((f.get("timing") for f in frames if f.get("type") == "result"), None) or {}
                if timing.get("spawn_wait_ms", 1e9) < 50:
                    return
                await asyncio.sleep(1.0)
        finally:
            await ws.close()
        raise AssertionError("the kernel never produced a warm run spare")

    asyncio.run(go())
    time.sleep(1.8)  # the spare taken by the probe is replaced


def run(coro: Any) -> Any:
    return asyncio.run(coro)


async def converse(kernel: Kernel, messages: list[tuple[dict, set[str]]], timeout: float = 60.0) -> list[list[dict]]:
    """Send each message on ONE socket, waiting for its terminal frame type; returns the frames per message."""
    ws = await connect(kernel)
    try:
        out = []
        for message, terminal in messages:
            frames, _ = await exchange(ws, message, terminal, timeout)
            frames += await drain(ws, 0.15)
            out.append(frames)
        return out
    finally:
        await ws.close()


def types(frames: list[dict]) -> list[str]:
    return [f.get("type") for f in frames]


def error_codes(frames: list[dict]) -> list[str]:
    return [f.get("code") for f in frames if f.get("type") == "error"]


def descendants(pid: int) -> list[int]:
    """Live descendants of ``pid`` (Linux /proc)."""
    parents: dict[int, int] = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat", "rb") as handle:
                parents[int(name)] = int(handle.read().rsplit(b")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            continue
    found: list[int] = []
    frontier = [pid]
    while frontier:
        parent = frontier.pop()
        children = [child for child, ppid in parents.items() if ppid == parent]
        found.extend(children)
        frontier.extend(children)
    return found


def running_descendants(pid: int) -> list[int]:
    running = []
    for child in descendants(pid):
        try:
            with open(f"/proc/{child}/stat", "rb") as handle:
                if handle.read().rsplit(b")", 1)[1].split()[0] == b"R":
                    running.append(child)
        except OSError:
            continue
    return running


linux_only = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="needs /proc")
