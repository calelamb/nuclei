"""One run-worker process as the pool sees it: spawn, control channel, output capture.

Output capture (design note section 2.8): the worker's stdout and stderr are pipes the pool reads
on two threads.  After every request the worker writes a per-worker random marker to both, so the
pool knows exactly where one request's output ends and can attribute it, enforce the 256 KiB cap
(draining the rest so the program never blocks on a full pipe) and stream it in 100 ms / 32 KiB
batches.
"""

from __future__ import annotations

import codecs
import json
import logging
import os
import queue
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from kernel import auth, lab_proc, run_ipc

logger = logging.getLogger(__name__)

BOOTSTRAP = (
    "import sys; sys.path.insert(0, sys.argv[1]); "
    "from kernel.run_worker_main import main; main()"
)
STREAM_FLUSH_SECONDS = 0.1
STREAM_FLUSH_BYTES = 32 * 1024
MARKER_GRACE_SECONDS = 1.0
SPAWN_TIMEOUT_SECONDS = 60.0
STDOUT, STDERR = "stdout", "stderr"


class WorkerSpawnError(RuntimeError):
    pass


class Sink(Protocol):
    def output(self, stream: str, text: str) -> None: ...

    def truncated(self, dropped_bytes: int) -> None: ...


class NullSink:
    def output(self, stream: str, text: str) -> None:
        return None

    def truncated(self, dropped_bytes: int) -> None:
        return None


# ------------------------------------------------------------------ environment


def worker_env() -> dict[str, str]:
    """The user's full environment minus Nuclei's own secrets (design note section 2.14).

    Never ``lab_proc.minimal_env``: that would strip HOME, proxies, QISKIT_* and provider variables
    a researcher's program legitimately needs.
    """
    env = auth.scrubbed_environment()
    for name in list(env):
        if name.startswith("NUCLEI_KERNEL_") or name == "NUCLEI_RUNTIME_DIR":
            del env[name]
    env.update({k: v for k, v in lab_proc.PINNED_ENV.items() if k.endswith("_THREADS")})
    env["MPLBACKEND"] = "Agg"
    env.setdefault("QDK_PYTHON_TELEMETRY", "none")
    env["NUCLEI_RUN_WORKER"] = "1"
    return env


def base_sys_path(repo_root: str, kernel_dir: str) -> list[str]:
    """The server's ``sys.path`` without Nuclei's own directories and ``PYTHONPATH`` (design note 2.14)."""
    drop = {os.path.realpath(p) for p in (repo_root, kernel_dir, os.getcwd()) if p}
    drop |= {os.path.realpath(p) for p in os.environ.get("PYTHONPATH", "").split(os.pathsep) if p}
    kept: list[str] = []
    for entry in sys.path:
        if not entry:
            continue
        real = os.path.realpath(entry)
        inside_repo = real == repo_root or real.startswith(os.path.realpath(repo_root) + os.sep)
        if real in drop or (inside_repo and "-packages" not in real):
            continue
        kept.append(entry)
    return kept


# --------------------------------------------------------------- marker splitting


def split_markers(buffer: bytes, prefix: bytes) -> tuple[list[tuple[bytes, int | None]], bytes]:
    """Split a stream chunk at end-of-request markers.

    Returns ``([(user_bytes, marker_seq | None), ...], held)``: every segment but the last ends with
    a marker (its ``seq``); ``held`` is a possible partial marker kept for the next chunk.
    """
    segments: list[tuple[bytes, int | None]] = []
    while True:
        index = buffer.find(prefix)
        if index < 0:
            break
        end = buffer.find(run_ipc.MARKER_SUFFIX, index + len(prefix))
        if end < 0:
            return segments + [(buffer[:index], None)], buffer[index:]
        seq_text = buffer[index + len(prefix) + 1:end]
        segments.append((buffer[:index], int(seq_text) if seq_text.isdigit() else -1))
        buffer = buffer[end + len(run_ipc.MARKER_SUFFIX):]
    cut = buffer.rfind(b"\x1e")
    hold = len(buffer) - cut if cut >= 0 and prefix.startswith(buffer[cut:]) else 0
    segments.append((buffer[:len(buffer) - hold], None))
    return segments, buffer[len(buffer) - hold:]


# ---------------------------------------------------------------- output budget


class ActiveOutput:
    """One request's captured output: cap accounting, UTF-8 decoding, batched delivery to the sink."""

    def __init__(self, sink: Sink, cap_bytes: int, streaming: bool):
        self.sink = sink
        self.cap = cap_bytes
        self.streaming = streaming
        self.sent = 0
        self.dropped = 0
        self._pending: list[tuple[str, str]] = []
        self._pending_bytes = 0
        self._last_flush = time.monotonic()
        self._decoders = {s: codecs.getincrementaldecoder("utf-8")("replace") for s in (STDOUT, STDERR)}
        self._lock = threading.Lock()

    def feed(self, stream: str, data: bytes) -> None:
        if not data:
            return
        with self._lock:
            room = max(self.cap - self.sent, 0)
            keep = data[:room]
            self.dropped += len(data) - len(keep)
            self.sent += len(keep)
            text = self._decoders[stream].decode(keep)
            if text:
                if self._pending and self._pending[-1][0] == stream:
                    self._pending[-1] = (stream, self._pending[-1][1] + text)
                else:
                    self._pending.append((stream, text))
                self._pending_bytes += len(keep)

    def flush(self, force: bool = False) -> None:
        with self._lock:
            due = self._pending_bytes >= STREAM_FLUSH_BYTES or time.monotonic() - self._last_flush >= STREAM_FLUSH_SECONDS
            if not self._pending or not (force or (self.streaming and due)):
                return
            batch, self._pending, self._pending_bytes = self._pending, [], 0
            self._last_flush = time.monotonic()
        for stream, text in batch:
            self._deliver(stream, text)

    def _deliver(self, stream: str, text: str) -> None:
        try:
            self.sink.output(stream, text)
        except Exception:  # noqa: BLE001 - a dead connection must not wedge the supervisor
            logger.debug("output sink failed", exc_info=True)

    def finish(self) -> None:
        self.flush(force=True)
        if self.dropped:
            try:
                self.sink.truncated(self.dropped)
            except Exception:  # noqa: BLE001
                logger.debug("truncation sink failed", exc_info=True)


# ------------------------------------------------------------------ the process


@dataclass
class WorkerProc:
    lane: str
    proc: subprocess.Popen
    control: socket.socket
    marker: str
    ready: dict = field(default_factory=dict)
    frames: "queue.Queue[Any]" = field(default_factory=queue.Queue)
    spawned_at: float = field(default_factory=time.monotonic)
    last_used: float = field(default_factory=time.monotonic)
    packages_stamp: float = 0.0
    baseline_rss: int = 0
    served: int = 0
    kill_reason: str | None = None
    active: ActiveOutput | None = None
    _seq: int = 0
    _markers: set = field(default_factory=set)
    _marker_cv: threading.Condition = field(default_factory=threading.Condition)

    @property
    def pid(self) -> int:
        return self.proc.pid

    @property
    def pgid(self) -> int:
        return int(self.ready.get("pgid") or self.proc.pid)

    def alive(self) -> bool:
        return self.proc.poll() is None

    def next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def send(self, obj: dict) -> None:
        run_ipc.send_frame(self.control, obj, run_ipc.TO_WORKER_MAX_BYTES)

    def kill(self, reason: str) -> None:
        """SIGKILL the worker's whole process group (the worker leads its own session)."""
        if self.kill_reason is None:
            self.kill_reason = reason
        try:
            if os.name == "posix":
                os.killpg(self.pgid, signal.SIGKILL)
            else:  # pragma: no cover - Windows
                self.proc.kill()
        except (ProcessLookupError, PermissionError, OSError):
            try:
                self.proc.kill()
            except OSError:
                pass

    def close(self) -> None:
        """Kill the group and release every handle; safe to call twice."""
        self.kill(self.kill_reason or "shutdown")
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        for handle in (self.control, self.proc.stdout, self.proc.stderr, self.proc.stdin):
            try:
                if handle is not None:
                    handle.close()
            except OSError:
                pass

    # -- marker bookkeeping ---------------------------------------------------

    def marker_seen(self, stream: str, seq: int) -> None:
        with self._marker_cv:
            self._markers.add((stream, seq))
            self._marker_cv.notify_all()

    def wait_markers(self, seq: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        with self._marker_cv:
            while not {(STDOUT, seq), (STDERR, seq)} <= self._markers:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._marker_cv.wait(remaining)
            self._markers -= {(STDOUT, seq), (STDERR, seq)}
            return True

    def _read_stream(self, stream: str, fileobj: Any) -> None:
        prefix = run_ipc.MARKER_PREFIX + self.marker.encode("ascii")
        held = b""
        fd = fileobj.fileno()
        while True:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return
            if not chunk:
                return
            segments, held = split_markers(held + chunk, prefix)
            for data, seq in segments:
                active = self.active
                if data and active is not None:
                    active.feed(stream, data)
                if seq is not None:
                    self.marker_seen(stream, seq)

    def _read_control(self) -> None:
        while True:
            try:
                frame = run_ipc.recv_frame(self.control, run_ipc.FROM_WORKER_MAX_BYTES)
            except (run_ipc.FrameError, OSError) as exc:
                self.frames.put(exc)
                return
            self.frames.put(frame)
            if frame is None:
                return

    def start_readers(self) -> None:
        for name, fileobj in ((STDOUT, self.proc.stdout), (STDERR, self.proc.stderr)):
            threading.Thread(target=self._read_stream, args=(name, fileobj), daemon=True).start()
        threading.Thread(target=self._read_control, daemon=True).start()


def spawn_worker(lane: str, repo_root: str, sys_path: list[str], session_preimports: tuple[str, ...] = ()) -> WorkerProc:
    """Start one worker and wait for its ``ready`` frame.  Call from a long-lived thread (PDEATHSIG)."""
    marker = secrets.token_hex(16)
    parent_sock, child_sock = socket.socketpair()
    hello = {
        "lane": lane, "marker": marker, "base_sys_path": sys_path, "parent_pid": os.getpid(),
        "control_fd": child_sock.fileno() if os.name == "posix" else None,
        "session_preimports": list(session_preimports),
    }
    kwargs: dict[str, Any] = {"pass_fds": (child_sock.fileno(),)} if os.name == "posix" else {}
    try:
        proc = subprocess.Popen(
            [sys.executable, "-I", "-c", BOOTSTRAP, repo_root],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=worker_env(),
            cwd=os.path.dirname(repo_root) or None, start_new_session=True, close_fds=True, **kwargs,
        )
    except OSError as exc:
        parent_sock.close()
        child_sock.close()
        raise WorkerSpawnError(f"could not start a run worker: {exc}") from exc
    child_sock.close()
    try:
        assert proc.stdin is not None
        proc.stdin.write((json.dumps(hello) + "\n").encode("utf-8"))
        proc.stdin.flush()
        proc.stdin.close()
    except OSError as exc:
        parent_sock.close()
        raise WorkerSpawnError(f"could not talk to the run worker: {exc}") from exc
    worker = WorkerProc(lane=lane, proc=proc, control=parent_sock, marker=marker)
    worker.start_readers()
    try:
        ready = worker.frames.get(timeout=SPAWN_TIMEOUT_SECONDS)
    except queue.Empty:
        worker.close()
        raise WorkerSpawnError("the run worker did not become ready in time") from None
    if not isinstance(ready, dict) or ready.get("t") != "ready":
        rc = proc.poll()
        worker.close()
        raise WorkerSpawnError(f"the run worker failed to start (exit {rc})")
    worker.ready = ready
    return worker


# ----------------------------------------------------------------- group scans


def scan_group(pgid: int) -> tuple[int, int]:
    """``(process count, total RSS bytes)`` of process group ``pgid``."""
    if sys.platform.startswith("linux"):
        count = rss = 0
        page = os.sysconf("SC_PAGE_SIZE")
        try:
            entries = os.listdir("/proc")
        except OSError:
            entries = []
        for name in entries:
            if not name.isdigit():
                continue
            try:
                with open(f"/proc/{name}/stat", "rb") as handle:
                    stat = handle.read().rsplit(b")", 1)[1].split()
                if int(stat[2]) != pgid:  # field 5 (pgrp) of the stat line
                    continue
                with open(f"/proc/{name}/statm", "rb") as handle:
                    resident = int(handle.read().split()[1])
            except (OSError, IndexError, ValueError):
                continue
            count += 1
            rss += resident * page
        return count, rss
    return _ps_scan(pgid)


def _ps_scan(pgid: int) -> tuple[int, int]:  # pragma: no cover - macOS / BSD: one `ps` per poll
    try:
        out = subprocess.run(
            ["ps", "-ax", "-o", "pgid=,rss="], capture_output=True, text=True, timeout=5, check=False,
            env=lab_proc.minimal_env(),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return 0, 0
    count = kib = 0
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] == str(pgid) and parts[1].isdigit():
            count += 1
            kib += int(parts[1])
    return count, kib * 1024
