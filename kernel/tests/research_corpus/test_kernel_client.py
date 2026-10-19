"""The real-kernel client harness: spawn, authenticate, isolate, clean up."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
import websockets

from kernel.tests._kernel_client import Kernel, connect, drain, exchange, memory_limit_supported

pytest.importorskip("qiskit")

BELL = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n"


@pytest.fixture(scope="module")
def kernel():
    with Kernel() as running:
        yield running


def test_authenticated_parse_round_trip(kernel: Kernel) -> None:
    async def scenario() -> list[dict]:
        ws = await connect(kernel)
        try:
            frames, _ = await exchange(ws, {"type": "parse", "code": BELL, "language": "python"}, {"snapshot"}, 30)
            return frames + await drain(ws, 0.2)
        finally:
            await ws.close()

    frames = asyncio.run(scenario())
    snapshot = next(f for f in frames if f["type"] == "snapshot")
    assert snapshot["data"]["framework"] == "qiskit" and snapshot["data"]["qubit_count"] == 2


def test_wrong_token_is_refused_with_4401(kernel: Kernel) -> None:
    async def scenario() -> int:
        ws = await websockets.connect(f"ws://localhost:{kernel.port}", origin="tauri://localhost")
        await ws.send('{"type": "authenticate", "token": "wrong", "nonce": "00"}')
        with pytest.raises(websockets.ConnectionClosed):
            await asyncio.wait_for(ws.recv(), 10)
        return ws.close_code

    assert asyncio.run(scenario()) == 4401


def test_foreign_origin_is_refused_at_the_upgrade(kernel: Kernel) -> None:
    async def scenario() -> int:
        with pytest.raises(websockets.exceptions.InvalidStatus) as refused:
            await websockets.connect(f"ws://localhost:{kernel.port}", origin="https://evil.example")
        return refused.value.response.status_code

    assert asyncio.run(scenario()) == 403


def test_exchange_reports_a_stalled_kernel_as_a_timeout_frame(kernel: Kernel) -> None:
    async def scenario() -> list[dict]:
        ws = await connect(kernel)
        try:
            frames, _ = await exchange(ws, {"type": "nonexistent_message"}, {"never"}, 1.0)
            return frames
        finally:
            await ws.close()

    assert asyncio.run(scenario())[-1]["type"] in ("__timeout__", "error")


def test_frame_sizes_are_recorded(kernel: Kernel) -> None:
    async def scenario() -> list[int]:
        ws = await connect(kernel)
        sizes: list[int] = []
        try:
            await exchange(ws, {"type": "parse", "code": BELL, "language": "python"}, {"snapshot"}, 30, sizes)
        finally:
            await ws.close()
        return sizes

    sizes = asyncio.run(scenario())
    assert sizes and all(n > 0 for n in sizes)


def test_runtime_dir_is_private_and_removed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NUCLEI_KERNEL_TOKEN", "leaked-token")
    monkeypatch.setenv("NUCLEI_KERNEL_DEV", "1")
    monkeypatch.setenv("DISPLAY", ":1")
    monkeypatch.setenv("MPLBACKEND", "TkAgg")
    k = Kernel(env={"EXTRA": "1", "HOME_NOT_SET": None})
    try:
        runtime = Path(k._env["NUCLEI_RUNTIME_DIR"])
        assert runtime.is_dir() and runtime != Path.home() / ".nuclei" / "runtime"
        assert not {"NUCLEI_KERNEL_TOKEN", "NUCLEI_KERNEL_DEV", "DISPLAY", "MPLBACKEND"} & set(k._env)
        assert k._env["NUCLEI_KERNEL_TOKEN_STDIN"] == "1" and k._env["EXTRA"] == "1"
    finally:
        k.stop()
    assert not runtime.exists()


def test_display_is_passed_through_only_when_asked() -> None:
    k = Kernel(display=":99")
    try:
        assert k._env["DISPLAY"] == ":99"
    finally:
        k.stop()


def test_stop_kills_the_kernel_and_its_children() -> None:
    k = Kernel()
    k.start()
    assert k.alive
    pid = k._proc.pid
    k.stop()
    assert not k.alive
    with pytest.raises(ProcessLookupError):
        os.killpg(pid, 0)  # the whole group is gone, not only the leader


def test_kernel_that_exits_during_startup_raises(tmp_path: Path) -> None:
    (tmp_path / "server.py").write_text("import sys; sys.stderr.write('boom\\n'); sys.exit(3)\n")
    k = Kernel(sys.executable, tmp_path, memory_limit_gb=None)
    try:
        with pytest.raises(RuntimeError, match=r"exited before ready \(rc=3\)"):
            k.start(ready_timeout=10)
    finally:
        k.stop()


def test_memory_cap_is_applied_where_prlimit_exists() -> None:
    k = Kernel(memory_limit_gb=2)
    try:
        assert k.memory_limited is memory_limit_supported()
        assert Kernel(memory_limit_gb=None).memory_limited is False
    finally:
        k.stop()


def test_module_launch_serves_the_same_kernel() -> None:
    async def scenario(k: Kernel) -> str:
        ws = await connect(k)
        try:
            frames, _ = await exchange(ws, {"type": "parse", "code": BELL, "language": "python"}, {"snapshot"}, 30)
            return frames[-1]["type"]
        finally:
            await ws.close()

    with Kernel(launch="module") as k:
        assert asyncio.run(scenario(k)) == "snapshot"


def test_unknown_launch_mode_is_rejected() -> None:
    with pytest.raises(ValueError, match="launch must be"):
        Kernel(launch="fork")
