"""A real kernel process plus an authenticated WebSocket client (protocol v2).

This is the one harness every end-to-end kernel test should use when it needs
the *real* server (``kernel/server.py``) instead of an in-process fake: it
spawns the kernel as a subprocess, hands it a per-run token on stdin exactly
like the desktop shell does, and speaks the same handshake as
``src/services/kernelSocket.ts`` (``authenticate`` frame with a nonce, then an
HMAC proof check on the ``authenticated`` reply).

Safety rules baked in:

* The kernel gets a private ``NUCLEI_RUNTIME_DIR`` (a temp dir removed on
  stop), so it never reads or rewrites the real ``~/.nuclei/runtime``.
* Every inherited ``NUCLEI_*`` variable is dropped, so a developer's token or
  dev flag never leaks into a test kernel.
* ``DISPLAY`` is dropped unless the caller passes one, so user code that opens a
  window (``plt.show()``) can never appear on a developer's desktop.
* On Linux the kernel runs under ``prlimit --as`` (default 8 GiB), so a
  runaway simulation fails with ``MemoryError`` instead of eating the box.
* ``launch="module"`` (or ``NUCLEI_CORPUS_LAUNCH=module``) starts it as ``python -m
  kernel.server`` instead of by script path, so the harness survives the move to the
  module launch without an edit.
* The kernel starts in its own process group; ``stop()`` kills the whole group,
  so user-code children (multiprocessing pools, worker subprocesses) die too.

Importing this module has no side effects. Nothing here weakens
authentication.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from collections.abc import Iterable, Mapping

import websockets

REPO_KERNEL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_ORIGIN = "tauri://localhost"
DEFAULT_MEMORY_LIMIT_GB = 8
READY_PREFIX = "Nuclei kernel ready on ws://localhost:"


class KernelStartError(RuntimeError):
    """The kernel exited, or never printed its ready line, during startup."""


def _memory_wrapper(limit_gb: float | None) -> list[str]:
    """``prlimit`` argv prefix capping address space, or ``[]`` when unavailable."""
    if not limit_gb or not sys.platform.startswith("linux"):
        return []
    prlimit = shutil.which("prlimit")
    if prlimit is None:
        return []
    return [prlimit, f"--as={int(limit_gb * (1 << 30))}"]


def memory_limit_supported() -> bool:
    """Can this host cap a kernel's address space (Linux with ``prlimit``)?"""
    return bool(_memory_wrapper(1))


def _child_env(runtime_dir: str, extra: Mapping[str, str | None], display: str | None) -> dict[str, str]:
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith("NUCLEI_") and k not in ("DISPLAY", "WAYLAND_DISPLAY", "MPLBACKEND")
    }
    env.update(
        {
            "NUCLEI_KERNEL_TOKEN_STDIN": "1",
            "NUCLEI_RUNTIME_DIR": runtime_dir,
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    if display:
        env["DISPLAY"] = display
    for key, value in extra.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    return env


class Kernel:
    """One kernel subprocess. Use as a context manager or call start()/stop()."""

    def __init__(
        self,
        python: str | os.PathLike[str] | None = None,
        kernel_dir: str | os.PathLike[str] | None = None,
        *,
        memory_limit_gb: float | None = DEFAULT_MEMORY_LIMIT_GB,
        env: Mapping[str, str | None] | None = None,
        display: str | None = None,
        launch: str | None = None,
    ) -> None:
        self.python = str(python or sys.executable)
        self.launch = launch or os.environ.get("NUCLEI_CORPUS_LAUNCH", "script")
        if self.launch not in ("script", "module"):
            raise ValueError(f"launch must be 'script' or 'module', not {self.launch!r}")
        self.kernel_dir = Path(kernel_dir or REPO_KERNEL_DIR).resolve()
        self.memory_limit_gb = memory_limit_gb
        self.token = secrets.token_urlsafe(32)
        self.port = 0
        self.stdout_lines: list[str] = []
        self.stderr_lines: list[str] = []
        self._runtime_dir = tempfile.mkdtemp(prefix="nuclei-kernel-runtime-")
        self._env = _child_env(self._runtime_dir, env or {}, display)
        self._proc: subprocess.Popen[str] | None = None

    # -- lifecycle ---------------------------------------------------------

    def start(self, ready_timeout: float = 45.0) -> float:
        """Spawn the kernel and wait for its ready line. Returns boot seconds."""
        started = time.monotonic()
        # "script": `python <kernel_dir>/server.py` (how the desktop shell launches today);
        # "module": `python -m kernel.server` from the kernel's parent (the post-R-B launch).
        target = ["-m", "kernel.server"] if self.launch == "module" else [str(self.kernel_dir / "server.py")]
        cwd = self.kernel_dir.parent if self.launch == "module" else self.kernel_dir
        argv = [*_memory_wrapper(self.memory_limit_gb), self.python, *target]
        self._proc = subprocess.Popen(
            argv,
            cwd=cwd,
            env=self._env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        assert self._proc.stdin is not None and self._proc.stdout is not None
        self._proc.stdin.write(self.token + "\n")
        self._proc.stdin.flush()
        self._proc.stdin.close()
        self._drain(self._proc.stderr, self.stderr_lines)
        self.port = self._await_ready(ready_timeout, started)
        self._drain(self._proc.stdout, self.stdout_lines)
        return time.monotonic() - started

    def _await_ready(self, ready_timeout: float, started: float) -> int:
        proc = self._proc
        assert proc is not None and proc.stdout is not None
        # readline() blocks, so a watchdog kills a kernel that never says "ready".
        watchdog = threading.Timer(ready_timeout, self._kill_group)
        watchdog.daemon = True
        watchdog.start()
        try:
            while True:
                line = proc.stdout.readline()
                if not line:
                    try:
                        proc.wait(5)  # stdout closed: reap the exit code instead of racing it
                    except subprocess.TimeoutExpired:
                        pass
                    time.sleep(0.05)  # let the stderr pump finish for the message below
                    raise KernelStartError(
                        f"kernel exited before ready (rc={proc.poll()}) after "
                        f"{time.monotonic() - started:.1f}s; stderr tail: {self.stderr_lines[-10:]}"
                    )
                self.stdout_lines.append(line.rstrip())
                if line.startswith(READY_PREFIX):
                    return int(line.strip().rsplit(":", 1)[1])
        finally:
            watchdog.cancel()

    @staticmethod
    def _drain(stream: Any, sink: list[str]) -> None:
        def pump() -> None:
            for line in stream:
                sink.append(line.rstrip())

        threading.Thread(target=pump, daemon=True).start()

    @property
    def memory_limited(self) -> bool:
        """True when the kernel runs under an address-space cap (Linux + prlimit)."""
        return bool(self.memory_limit_gb) and memory_limit_supported()

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def _kill_group(self) -> None:
        proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            proc.kill()

    def stop(self) -> None:
        """Kill the kernel's whole process group and remove its runtime dir."""
        proc = self._proc
        if proc is not None:
            if proc.poll() is None:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    proc.terminate()
                try:
                    proc.wait(5)
                except subprocess.TimeoutExpired:
                    self._kill_group()
                    proc.wait(5)
            self._kill_group()  # reap children that outlived the leader
        shutil.rmtree(self._runtime_dir, ignore_errors=True)

    def __enter__(self) -> "Kernel":
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()


async def connect(
    kernel: Kernel,
    *,
    origin: str = DEFAULT_ORIGIN,
    token: str | None = None,
    max_size: int | None = None,
    open_timeout: float = 10.0,
) -> Any:
    """Open an authenticated connection (asserts the kernel's HMAC proof)."""
    ws = await websockets.connect(
        f"ws://localhost:{kernel.port}", origin=origin, max_size=max_size, open_timeout=open_timeout
    )
    nonce = secrets.token_hex(32)
    await ws.send(json.dumps({"type": "authenticate", "token": token or kernel.token, "nonce": nonce}))
    ack = json.loads(await asyncio.wait_for(ws.recv(), 12))
    if ack.get("type") != "authenticated":
        await ws.close()
        raise AssertionError(f"kernel refused authentication: {ack}")
    expect = hmac.new(kernel.token.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(ack.get("proof", "")), expect):
        await ws.close()
        raise AssertionError("kernel proof mismatch")
    return ws


async def exchange(
    ws: Any,
    message: Mapping[str, Any],
    terminal: Iterable[str],
    timeout: float = 60.0,
    frame_sizes: list[int] | None = None,
) -> tuple[list[dict[str, Any]], float]:
    """Send ``message`` and collect frames until one whose type is in ``terminal``.

    A synthetic ``{"type": "__timeout__"}`` or ``{"type": "__closed__", code,
    reason}`` frame ends the list when the kernel stalls or drops the socket.
    When ``frame_sizes`` is given, the byte length of every received frame is
    appended to it. Returns ``(frames, seconds)``.
    """
    terminal = frozenset(terminal)
    await ws.send(json.dumps(message))
    frames: list[dict[str, Any]] = []
    started = time.monotonic()
    while True:
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            frames.append({"type": "__timeout__"})
            break
        try:
            raw = await asyncio.wait_for(ws.recv(), remaining)
        except asyncio.TimeoutError:
            frames.append({"type": "__timeout__"})
            break
        except websockets.ConnectionClosed as exc:
            frames.append(
                {
                    "type": "__closed__",
                    "code": exc.rcvd.code if exc.rcvd else None,
                    "reason": exc.rcvd.reason if exc.rcvd else None,
                }
            )
            break
        if frame_sizes is not None:
            frame_sizes.append(len(raw))
        frame = json.loads(raw)
        frames.append(frame)
        if frame.get("type") in terminal:
            break
    return frames, time.monotonic() - started


async def drain(ws: Any, idle: float = 0.4) -> list[dict[str, Any]]:
    """Collect frames until the socket has been quiet for ``idle`` seconds."""
    frames: list[dict[str, Any]] = []
    while True:
        try:
            frames.append(json.loads(await asyncio.wait_for(ws.recv(), idle)))
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            return frames
