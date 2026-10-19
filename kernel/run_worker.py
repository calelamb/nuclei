"""The warm run-worker pool: every message that executes user code goes through here.

Design note: ``docs/research/PRD_15/R_EXECUTION_MODEL.md`` section 2.  A fresh interpreter costs
~1.3 s and ~270 MB just to import numpy / qiskit / aer / cirq, so workers are persistent and
pre-imported (``kernel.run_worker_main``) instead of started per run:

* the **preview** lane is exactly one reusable worker.  It serves parse, transpile, debug, the
  Lab's inspect / lint ... and owns the loaded-circuit cache, so an edit pause executes the program
  once.  It is reset after every request and recycled when it gets dirty, times out, is cancelled
  or dies.
* the **run** lane starts a fresh process per Run (a warm spare is spawned in the background the
  moment one is taken), so queued previews can never delay Run.

The pool is a process-wide singleton with its own threads; ``submit`` is thread-safe and returns a
``concurrent.futures.Future``.  The worker runs in its own session/process group, so wall-clock,
group-RSS and cancel limits are all enforced by killing the group.  The kernel server never sees
an exception from user code: a runaway, an ``os._exit`` or an out-of-memory program becomes an
error result and the next request gets a fresh worker.
"""

from __future__ import annotations

import asyncio
import atexit
import collections
import concurrent.futures
import itertools
import logging
import os
import queue
import signal
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from kernel import project_paths, run_memory, run_ops
from kernel.run_worker_proc import (
    ActiveOutput, NullSink, Sink, WorkerProc, WorkerSpawnError, base_sys_path, scan_group, spawn_worker,
)

logger = logging.getLogger(__name__)

RSS_FRACTION = 0.40
MIN_RSS_BYTES = 1 << 30
DIRTY_RSS_GROWTH_BYTES = 1 << 30
OUTPUT_CAP_BYTES = 256 * 1024
LOW_RAM_NO_SPARE_BYTES = 6 * (1 << 30)
SPARE_BOOST_WINDOW_S = 2.0
SPARE_BOOST_HOLD_S = 60.0
FINAL_FRAME_GRACE_S = 0.5
TICK_S = 0.05
MIN_WALL_S, MAX_WALL_S = 1.0, 86_400.0
FATAL_CODES = frozenset({"timeout", "cancelled", "worker_died", "too_much_memory"})
SIGNAL_NAMES = {signal.SIGSEGV: "SIGSEGV", signal.SIGBUS: "SIGBUS", signal.SIGABRT: "SIGABRT",
                signal.SIGFPE: "SIGFPE", signal.SIGILL: "SIGILL"} if os.name == "posix" else {}


# ---------------------------------------------------------------------- config


@dataclass(frozen=True)
class PoolConfig:
    repo_root: str
    kernel_dir: str
    sys_path: tuple[str, ...]
    wall_override_s: float | None
    max_rss_bytes: int
    rss_from_env: bool
    output_cap_bytes: int
    run_spares: int
    max_busy_runs: int = 2
    spawn_threads: int = 2
    spare_idle_s: float = 1800.0
    supersede_kill_after_s: float = 2.0
    rss_poll_s: float = 0.25

    @classmethod
    def from_env(cls, repo_root: str | None = None) -> "PoolConfig":
        root = repo_root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        kernel_dir = os.path.join(root, "kernel")
        ram = run_memory.physical_ram_bytes()
        rss_mb = _env_int("NUCLEI_RUN_MAX_RSS_MB")
        wall = _env_int("NUCLEI_RUN_WALL_S")
        cap_kb = _env_int("NUCLEI_RUN_OUTPUT_CAP_KB")
        return cls(
            repo_root=root, kernel_dir=kernel_dir, sys_path=tuple(base_sys_path(root, kernel_dir)),
            wall_override_s=float(wall) if wall else None,
            max_rss_bytes=rss_mb * (1 << 20) if rss_mb else max(MIN_RSS_BYTES, int(ram * RSS_FRACTION)),
            rss_from_env=bool(rss_mb), output_cap_bytes=cap_kb * 1024 if cap_kb else OUTPUT_CAP_BYTES,
            run_spares=0 if ram < LOW_RAM_NO_SPARE_BYTES else 1,
        )


def _env_int(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw.isdigit() and int(raw) > 0 else None


# --------------------------------------------------------------- request / result


@dataclass
class RunRequest:
    op: str
    owner: int
    args: dict
    ctx: dict = field(default_factory=dict)
    run_id: str | None = None
    lane: str = run_ops.PREVIEW
    wall_s: float = 30.0
    coalesce: str | None = None  # a newer request with the same key from the same owner supersedes this
    streaming: bool = True  # False: buffer output and deliver it when the request ends


@dataclass
class PoolResult:
    reply: dict | None = None
    error: dict | None = None
    superseded: bool = False
    pool_error: bool = False  # the error came from the pool (timeout, death, ...), not from the op
    stats: dict = field(default_factory=dict)
    timing: dict = field(default_factory=dict)


class OpError(Exception):
    """A worker op failed; ``error`` is its wire form (``code``, ``message``, ...)."""

    def __init__(self, error: dict):
        super().__init__(error.get("message", ""))
        self.error = error


class DuplicateRunId(ValueError):
    pass


def pool_error(code: str, message: str, **extra: Any) -> dict:
    return {"code": code, "message": message, **extra}


def _gigabytes(value: int) -> str:
    return f"{value / 1e9:.1f} GB"


class _Handle:
    def __init__(self, pool: "RunPool", req: RunRequest, sink: Sink, key: tuple[int, str]):
        self.pool, self.req, self.sink, self.key = pool, req, sink, key
        self.future: concurrent.futures.Future = concurrent.futures.Future()
        self.cancelled = threading.Event()
        self.superseded = False
        self.state = "queued"
        self.submitted = time.monotonic()
        self.started: float | None = None

    def finish(self, result: PoolResult) -> None:
        with self.pool._lock:
            if self.state == "done":
                return
            self.state = "done"
            self.pool._runs.pop(self.key, None)
        result.timing.setdefault("total_ms", round((time.monotonic() - self.submitted) * 1000, 1))
        self.future.set_result(result)


# ------------------------------------------------------------------------ pool


class RunPool:
    def __init__(self, config: PoolConfig | None = None):
        self.config = config or PoolConfig.from_env()
        self._lock = threading.RLock()
        self._cv = threading.Condition(self._lock)
        self._runs: dict[tuple[int, str], _Handle] = {}
        self._preview_queue: collections.deque[_Handle] = collections.deque()
        self._preview_running: _Handle | None = None
        self._preview: WorkerProc | None = None
        self._preview_spawning = False
        self._preview_error: BaseException | None = None
        self._spares: list[WorkerProc] = []
        self._spawning_spares = 0
        self._spawn_queue: queue.Queue = queue.Queue()
        self._run_slots = threading.Semaphore(self.config.max_busy_runs)
        self._run_times: collections.deque[float] = collections.deque(maxlen=8)
        self._boost_until = 0.0
        self._anon = itertools.count(1)
        self._session_preimports: set[str] = set()
        self._closing = False
        self._started = False
        self._threads: list[threading.Thread] = []
        self._stamp = self._packages_stamp()
        self.spawned = 0

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Start the pool's threads and warm a preview worker and a run spare in the background."""
        with self._lock:
            if self._started or self._closing:
                return
            self._started = True
        for index in range(self.config.spawn_threads):
            self._thread(self._spawn_loop, f"nuclei-spawn-{index}")
        self._thread(self._preview_loop, "nuclei-preview")
        self._thread(self._janitor_loop, "nuclei-janitor")
        self._ensure_preview()
        self._top_up_spares()

    def _thread(self, target: Callable[[], None], name: str) -> None:
        thread = threading.Thread(target=target, name=name, daemon=True)
        thread.start()
        self._threads.append(thread)

    def shutdown(self) -> None:
        with self._cv:
            if self._closing:
                return
            self._closing = True
            handles = list(self._runs.values())
            workers = [self._preview, *self._spares]
            self._preview, self._spares = None, []
            self._cv.notify_all()
        for handle in handles:
            handle.cancelled.set()
        for worker in workers:
            if worker is not None:
                worker.close()
        for _ in range(self.config.spawn_threads):
            self._spawn_queue.put(None)

    def diagnostics(self) -> dict:
        with self._lock:
            return {
                "preview_pid": self._preview.pid if self._preview else None,
                "spares": len(self._spares), "spawned": self.spawned, "runs": len(self._runs),
                "queued_previews": len(self._preview_queue),
            }

    # -- submission --------------------------------------------------------

    def submit(self, req: RunRequest, sink: Sink | None = None) -> concurrent.futures.Future:
        self.start()
        run_key = req.run_id or f"anon-{next(self._anon)}"
        handle = _Handle(self, req, sink or NullSink(), (req.owner, run_key))
        with self._cv:
            if self._closing:
                handle.state = "done"
                handle.future.set_result(PoolResult(error=pool_error("worker_died", "The kernel is shutting down."), pool_error=True))
                return handle.future
            if handle.key in self._runs:
                raise DuplicateRunId(f"run_id {run_key!r} is already active")
            self._runs[handle.key] = handle
            if req.lane == run_ops.PREVIEW:
                self._queue_preview(handle)
            else:
                self._note_run_arrival()
                self._thread(lambda h=handle: self._run_lane(h), f"nuclei-run-{run_key}")
        return handle.future

    def _queue_preview(self, handle: _Handle) -> None:
        key = handle.req.coalesce
        if key:
            for queued in [h for h in self._preview_queue if h.req.coalesce == key and h.req.owner == handle.req.owner]:
                self._preview_queue.remove(queued)
                queued.finish(PoolResult(superseded=True))
            running = self._preview_running
            if running is not None and running.req.coalesce == key and running.req.owner == handle.req.owner:
                running.superseded = True
        self._preview_queue.append(handle)
        self._cv.notify_all()

    def cancel(self, owner: int, run_id: str) -> bool:
        """Cancel a queued or running request; ``False`` for a finished or unknown one (a stale Stop)."""
        with self._cv:
            handle = self._runs.get((owner, run_id))
            if handle is None or handle.state == "done":
                return False
            handle.cancelled.set()
            queued = handle in self._preview_queue
            if queued:
                self._preview_queue.remove(handle)
        if queued:
            handle.finish(PoolResult(error=pool_error("cancelled", "The run was cancelled."), pool_error=True))
        return True

    def release_owner(self, owner: int) -> None:
        """A connection closed: cancel everything it still has in flight."""
        with self._lock:
            keys = [key for key in self._runs if key[0] == owner]
        for _owner, run_id in keys:
            self.cancel(owner, run_id)

    # -- spawning ----------------------------------------------------------

    def _spawn_loop(self) -> None:
        while True:
            job = self._spawn_queue.get()
            if job is None:
                return
            lane, future = job
            if not future.set_running_or_notify_cancel():
                continue
            try:
                worker = spawn_worker(lane, self.config.repo_root, list(self.config.sys_path), tuple(sorted(self._session_preimports)))
                worker.packages_stamp = self._stamp
                worker.baseline_rss = scan_group(worker.pgid)[1]
            except Exception as exc:  # noqa: BLE001 - reported to whoever waits on the future
                if lane == run_ops.PREVIEW:
                    self._preview_ready(None, exc)
                future.set_exception(exc)
                continue
            with self._lock:
                self.spawned += 1
            if lane == run_ops.PREVIEW:
                self._preview_ready(worker, None)
            future.set_result(worker)

    def _submit_spawn(self, lane: str) -> concurrent.futures.Future:
        future: concurrent.futures.Future = concurrent.futures.Future()
        self._spawn_queue.put((lane, future))
        return future

    def _ensure_preview(self) -> None:
        """Make sure a preview worker exists or is on its way (the spawn thread installs it)."""
        with self._lock:
            if self._preview is not None or self._closing or self._preview_spawning:
                return
            self._preview_spawning = True
        self._submit_spawn(run_ops.PREVIEW)

    def _preview_ready(self, worker: WorkerProc | None, error: BaseException | None) -> None:
        with self._cv:
            self._preview_spawning = False
            if worker is not None and (self._closing or self._preview is not None):
                worker.close()
            elif worker is not None:
                self._preview = worker
            else:
                logger.warning("preview worker failed to start: %s", error)
                self._preview_error = error
            self._cv.notify_all()

    def _spare_target(self) -> int:
        base = self.config.run_spares
        if base and time.monotonic() < self._boost_until:
            return max(base, min(3, (os.cpu_count() or 2) // 2))
        return base

    def _note_run_arrival(self) -> None:
        now = time.monotonic()
        self._run_times.append(now)
        if sum(1 for t in self._run_times if now - t < SPARE_BOOST_WINDOW_S) >= 2:
            self._boost_until = now + SPARE_BOOST_HOLD_S

    def _top_up_spares(self) -> None:
        with self._lock:
            missing = self._spare_target() - len(self._spares) - self._spawning_spares
            if self._closing or missing <= 0:
                return
            self._spawning_spares += missing
        for _ in range(missing):
            self._submit_spawn(run_ops.RUN).add_done_callback(self._spare_spawned)

    def _spare_spawned(self, future: concurrent.futures.Future) -> None:
        with self._lock:
            self._spawning_spares -= 1
            if future.exception() is not None:
                logger.warning("run spare failed to start: %s", future.exception())
                return
            worker = future.result()
            if self._closing:
                worker.close()
            else:
                self._spares.append(worker)

    # -- janitor: idle spares, package changes -----------------------------

    def _packages_stamp(self) -> float:
        stamp = 0.0
        for entry in self.config.sys_path:
            if "-packages" in entry:
                try:
                    stamp = max(stamp, os.stat(entry).st_mtime)
                except OSError:
                    continue
        return stamp

    def _recycle_if_packages_changed(self) -> None:
        stamp = self._packages_stamp()
        if stamp == self._stamp:
            return
        self._stamp = stamp
        with self._lock:
            stale, self._spares = self._spares, []
            if self._preview is not None and self._preview_running is None:
                stale.append(self._preview)
                self._preview = None
        for worker in stale:
            worker.close()
        self._ensure_preview()
        self._top_up_spares()

    def _janitor_loop(self) -> None:
        while not self._closing:
            time.sleep(5.0)
            now = time.monotonic()
            with self._lock:
                idle = [w for w in self._spares if now - w.last_used > self.config.spare_idle_s or not w.alive()]
                self._spares = [w for w in self._spares if w not in idle]
            for worker in idle:
                worker.close()
            self._recycle_if_packages_changed()

    # -- the preview lane --------------------------------------------------

    def _preview_loop(self) -> None:
        while True:
            with self._cv:
                while not self._preview_queue and not self._closing:
                    self._cv.wait()
                if self._closing:
                    return
                handle = self._preview_queue.popleft()
                self._preview_running = handle
            try:
                self._serve_preview(handle)
            except Exception as exc:  # noqa: BLE001 - the loop must outlive a bad request
                logger.exception("preview request failed")
                handle.finish(PoolResult(error=pool_error("worker_internal", f"{type(exc).__name__}: {exc}"), pool_error=True))
            finally:
                with self._lock:
                    self._preview_running = None

    def _serve_preview(self, handle: _Handle) -> None:
        if handle.cancelled.is_set():
            handle.finish(PoolResult(error=pool_error("cancelled", "The run was cancelled."), pool_error=True))
            return
        self._recycle_if_packages_changed()
        waited = time.monotonic()
        try:
            worker = self._await_preview(handle)
        except WorkerSpawnError as exc:
            handle.finish(PoolResult(error=pool_error("worker_died", str(exc), reason="spawn_failed"), pool_error=True))
            return
        if worker is None:
            handle.finish(PoolResult(error=pool_error("cancelled", "The run was cancelled."), pool_error=True))
            return
        result = self._supervise(worker, handle, (time.monotonic() - waited) * 1000)
        self._after_preview(worker, result)
        handle.finish(result)

    def _await_preview(self, handle: _Handle) -> WorkerProc | None:
        while True:
            self._ensure_preview()
            with self._cv:
                worker = self._preview
                if worker is not None and worker.alive():
                    return worker
                if worker is not None:
                    self._preview = None
                    worker.close()
                    continue
                if self._preview_error is not None and not self._preview_spawning:
                    error, self._preview_error = self._preview_error, None
                    raise WorkerSpawnError(str(error))
                self._cv.wait(TICK_S)
            if handle.cancelled.is_set() or self._closing:
                return None

    def _after_preview(self, worker: WorkerProc, result: PoolResult) -> None:
        reusable = bool(result.stats.get("reusable")) and not result.pool_error and worker.alive()
        if reusable:
            count, rss = scan_group(worker.pgid)
            reusable = count <= 1 and rss <= worker.baseline_rss + DIRTY_RSS_GROWTH_BYTES
            if not reusable:
                result.stats["dirty_reason"] = "children" if count > 1 else "rss"
        if reusable:
            worker.last_used = time.monotonic()
            return
        with self._lock:
            if self._preview is worker:
                self._preview = None
        worker.close()
        self._ensure_preview()

    # -- the run lane ------------------------------------------------------

    def _run_lane(self, handle: _Handle) -> None:
        worker: WorkerProc | None = None
        try:
            while not self._run_slots.acquire(timeout=TICK_S):
                if handle.cancelled.is_set() or self._closing:
                    handle.finish(PoolResult(error=pool_error("cancelled", "The run was cancelled."), pool_error=True))
                    return
            try:
                waited = time.monotonic()
                worker = self._take_run_worker(handle)
                if worker is None:
                    handle.finish(PoolResult(error=pool_error("cancelled", "The run was cancelled."), pool_error=True))
                    return
                result = self._supervise(worker, handle, (time.monotonic() - waited) * 1000)
                handle.finish(result)
            finally:
                self._run_slots.release()
        except WorkerSpawnError as exc:
            handle.finish(PoolResult(error=pool_error("worker_died", str(exc), reason="spawn_failed"), pool_error=True))
        except Exception as exc:  # noqa: BLE001
            logger.exception("run request failed")
            handle.finish(PoolResult(error=pool_error("worker_internal", f"{type(exc).__name__}: {exc}"), pool_error=True))
        finally:
            if worker is not None:
                worker.close()
            self._top_up_spares()

    def _take_run_worker(self, handle: _Handle) -> WorkerProc | None:
        with self._lock:
            while self._spares:
                spare = self._spares.pop(0)
                if spare.alive():
                    break
                spare.close()
            else:
                spare = None
        if spare is not None:
            self._top_up_spares()
            return spare
        future = self._submit_spawn(run_ops.RUN)
        while True:
            try:
                return future.result(timeout=TICK_S)
            except concurrent.futures.TimeoutError:
                if handle.cancelled.is_set() or self._closing:
                    future.add_done_callback(lambda f: f.exception() is None and f.result().close())
                    return None

    # -- supervising one request -------------------------------------------

    def _wall_for(self, req: RunRequest) -> float:
        wall = req.wall_s
        if self.config.wall_override_s:
            wall = self.config.wall_override_s
        requested = (req.ctx.get("limits") or {}).get("wall_s")
        if isinstance(requested, (int, float)) and not isinstance(requested, bool):
            wall = min(max(float(requested), MIN_WALL_S), MAX_WALL_S)
        return wall

    def _supervise(self, worker: WorkerProc, handle: _Handle, spawn_wait_ms: float) -> PoolResult:
        req = handle.req
        seq = worker.next_seq()
        active = ActiveOutput(handle.sink, self.config.output_cap_bytes, req.streaming)
        worker.active = active
        handle.state = "running"
        started = handle.started = time.monotonic()
        wall = self._wall_for(req)
        done: dict | None = None
        verdict: dict | None = None
        try:
            worker.send({"t": "req", "seq": seq, "op": req.op, "run_id": req.run_id or "", "ctx": req.ctx, "args": req.args})
            next_rss = started + self.config.rss_poll_s
            while done is None and verdict is None:
                done, verdict = self._tick(worker, handle, seq, started, wall)
                now = time.monotonic()
                if done is None and verdict is None and now >= next_rss:
                    next_rss = now + self.config.rss_poll_s
                    verdict = self._check_memory(worker)
                active.flush()
        except Exception as exc:  # noqa: BLE001 - a dead control socket is a dead worker
            verdict = verdict or self._died(worker, f"control channel failed: {exc}")
        if verdict is not None:
            worker.kill(worker.kill_reason or "verdict")
            worker.wait_markers(seq, 0.2)
            result = PoolResult(superseded=True) if verdict["code"] == "superseded" else PoolResult(error=verdict, pool_error=True)
        else:
            worker.wait_markers(seq, 1.0)
            worker.served += 1
            result = PoolResult(reply=done.get("reply"), error=done.get("error"), stats=done.get("stats") or {})
        active.finish()
        worker.active = None
        return self._with_timing(result, handle, started, spawn_wait_ms)

    def _with_timing(self, result: PoolResult, handle: _Handle, started: float, spawn_wait_ms: float) -> PoolResult:
        end = time.monotonic()
        result.superseded = result.superseded or handle.superseded
        result.timing = {
            "queue_ms": round(max(started - handle.submitted - spawn_wait_ms / 1000, 0) * 1000, 1),
            "spawn_wait_ms": round(spawn_wait_ms, 1) if handle.req.lane == run_ops.RUN else 0.0,
            "exec_ms": result.stats.get("exec_ms", 0.0), "op_ms": result.stats.get("op_ms", 0.0),
            "total_ms": round((end - handle.submitted) * 1000, 1),
        }
        return result

    def _tick(self, worker: WorkerProc, handle: _Handle, seq: int, started: float, wall: float):
        """One supervision step: ``(done_frame | None, verdict_error | None)``."""
        now = time.monotonic()
        if handle.cancelled.is_set():
            worker.kill_reason = "cancel"
            return None, pool_error("cancelled", "The run was cancelled.")
        if handle.superseded and now - started >= self.config.supersede_kill_after_s:
            worker.kill_reason = "superseded"
            return None, pool_error("superseded", "superseded")
        if now - started >= wall:
            worker.kill_reason = "wall"
            return None, pool_error(
                "timeout", f"Your code ran longer than {wall:g} s and was stopped.", limit_s=wall, reason="wall"
            )
        try:
            item = worker.frames.get(timeout=TICK_S)
        except queue.Empty:
            return None, (self._died_if_exited(worker, seq) if not worker.alive() else None)
        if isinstance(item, dict) and item.get("t") == "done" and item.get("seq") == seq:
            return item, None
        if isinstance(item, dict) and item.get("t") == "log":
            logger.log(logging.INFO, "worker: %s", item.get("msg"))
            return None, None
        if item is None or isinstance(item, Exception):
            return None, self._died(worker, "protocol" if isinstance(item, Exception) else "closed")
        return None, None

    def _died_if_exited(self, worker: WorkerProc, seq: int):
        """The process is gone: a final ``done`` may still be in flight (run workers exit right after it)."""
        deadline = time.monotonic() + FINAL_FRAME_GRACE_S
        while time.monotonic() < deadline:
            try:
                item = worker.frames.get(timeout=TICK_S)
            except queue.Empty:
                continue
            if isinstance(item, dict) and item.get("t") == "done" and item.get("seq") == seq:
                worker.frames.put(item)
                return None
            if item is None or isinstance(item, Exception):
                break
        return self._died(worker, "exited")

    def _check_memory(self, worker: WorkerProc) -> dict | None:
        _count, rss = scan_group(worker.pgid)
        limit = self.config.max_rss_bytes
        if rss <= limit:
            return None
        worker.kill_reason = "memory"
        share = "" if self.config.rss_from_env else f" (limit {int(RSS_FRACTION * 100)}% of RAM)"
        return pool_error(
            "too_much_memory", f"Your program used more than {_gigabytes(limit)}{share} and was stopped.",
            rss_bytes=rss, limit_bytes=limit,
        )

    def _died(self, worker: WorkerProc, why: str) -> dict:
        try:
            rc = worker.proc.wait(timeout=2)
        except Exception:  # noqa: BLE001 - still running: a protocol failure; kill it below
            worker.kill("protocol")
            rc = worker.proc.poll()
        lead = "The Python worker running your code"
        if worker.kill_reason in ("wall", "cancel", "memory", "superseded"):
            return pool_error("worker_died", f"{lead} was stopped.", reason=worker.kill_reason)
        if rc is not None and rc < 0:
            number = -rc
            if number == getattr(signal, "SIGXCPU", -1):
                return pool_error("timeout", "Your code used more CPU time than its limit and was stopped.", reason="cpu")
            if number == getattr(signal, "SIGKILL", -1):
                return pool_error("worker_died", f"{lead} was killed by the operating system — usually because the machine ran out of memory.", reason="killed_by_os")
            name = SIGNAL_NAMES.get(number, f"signal {number}")
            return pool_error("worker_died", f"{lead} crashed inside a native library ({name}).", reason=name)
        return pool_error(
            "worker_died",
            f"{lead} exited (os._exit or a native crash). The kernel is fine — run again.",
            reason=f"exited:{rc}" if why != "protocol" else "protocol",
        )


# ----------------------------------------------------------------- the singleton

_pool: RunPool | None = None
_pool_lock = threading.Lock()
_inprocess_ops = False


def get_pool() -> RunPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = RunPool()
            atexit.register(_pool.shutdown)
        return _pool


def pool_started() -> bool:
    return _pool is not None


def shutdown_pool() -> None:
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool is not None:
        pool.shutdown()


def set_inprocess_ops(enabled: bool) -> None:
    """Tests only: let ``call_op`` run message ops in the calling process (monkeypatch-friendly)."""
    global _inprocess_ops
    _inprocess_ops = enabled


def pool_for_ctx(ctx: Any) -> RunPool:
    return get_pool()


async def call_op(ctx: Any, fn: Callable[..., Any], msg: dict) -> Any:
    """Run a registered message op (``@worker_op``) for a Lab handler; returns its reply.

    The op runs in the preview worker with the loaded-circuit cache shared with ``parse``, so the
    program executes once per code version. Failures raise :class:`OpError` (including the pool's
    ``timeout`` / ``worker_died`` / ``cancelled``).
    """
    spec = run_ops.spec_of(fn)
    if _inprocess_ops:
        reply, error = await asyncio.to_thread(spec.invoke, None, msg)
        if error is not None:
            raise OpError(error)
        return reply
    try:
        paths = project_paths.resolve(msg.get("project_root"), msg.get("file_path"), None)
    except project_paths.PathError as exc:
        raise OpError(pool_error("invalid_path", exc.message, **exc.to_error_fields())) from exc
    request = RunRequest(
        op=spec.ref, owner=ctx.owner, args=msg, lane=spec.lane, wall_s=spec.wall_s, streaming=False,
        ctx={
            "language": msg.get("language"), "project_root": paths.project_root, "file_path": paths.file_path,
            "params": msg.get("params") if isinstance(msg.get("params"), dict) else {},
            "cache": "use" if spec.cached else "none",
        },
    )
    result = await asyncio.wrap_future(get_pool().submit(request))
    if result.error is not None:
        raise OpError(result.error)
    return result.reply
