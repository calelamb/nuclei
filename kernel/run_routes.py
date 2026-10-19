"""Server-side routes for the messages that execute user code (design note section 2.5).

``parse``, ``execute``, ``run_python``, ``transpile``, ``debug_trace``, ``qec_snapshot``,
``qec_materialize``, ``qec_estimate`` and ``run_cancel`` are validated here, handed to the run-worker
pool and answered with the same frames the in-process handlers used to send.  Each request is its
own task, so the connection loop keeps reading and sees ``run_cancel`` and newer parses while an
older request is still running.

Wire compatibility (design note D10): a request without ``run_id`` gets exactly today's frame
sequence (plus the new safety error codes).  A request that carries a ``run_id`` is a v1.4 request:
every frame of it echoes the id, snapshots add ``preview`` / ``elapsed_ms`` / ``slow`` and results
add ``timing`` and ``data.run_dir``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import time
from dataclasses import dataclass
from typing import Any

from kernel import project_paths, run_ops, run_ops_builtin, run_worker  # noqa: F401 - run_ops_builtin registers the editor ops
from kernel.models import KernelError
from kernel.models.errors import error_payload
from kernel.run_worker import DuplicateRunId, PoolResult, RunRequest
from kernel.run_worker_proc import STDERR

logger = logging.getLogger(__name__)

RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
SNAPSHOT_ERROR_CODES = frozenset({"unsupported_framework", "missing_dependency", "no_circuit", "execution_error", "adapter_error"})
MPS_METHOD = "matrix_product_state"
PHASES = {
    "parse": "parse", "execute": "execute", "run_python": "python", "transpile": "transpile", "debug_trace": "debug",
    "qec_snapshot": "qec_snapshot", "qec_materialize": "qec_materialize", "qec_estimate": "qec_estimate",
}
#: What a failed request still owes the client after its ``error`` frame (design note section 6.3).
TERMINAL_FRAMES = {
    "execute": {"type": "result", "data": None},
    "run_python": {"type": "python_result", "success": False},
    "transpile": {"type": "transpile_result", "data": None},
    "debug_trace": {"type": "debug_trace_result", "data": None},
}
ROUTED_TYPES = frozenset({*PHASES, "run_cancel"})
RUN_DIR_KINDS = frozenset({"execute", "run_python"})


class _Sender:
    """One ordered outbound queue per connection: pool threads and request tasks all send through it."""

    def __init__(self, websocket: Any, loop: asyncio.AbstractEventLoop):
        self._websocket = websocket
        self._loop = loop
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._task = loop.create_task(self._pump())

    async def _pump(self) -> None:
        while True:
            text = await self._queue.get()
            if text is None:
                return
            try:
                await self._websocket.send(text)
            except Exception:  # noqa: BLE001 - the connection is gone; later frames have nowhere to go
                return

    def send_text(self, text: str) -> None:
        self._queue.put_nowait(text)

    def send(self, payload: dict) -> None:
        self._queue.put_nowait(json.dumps(payload))

    def send_from_thread(self, payload: dict) -> None:
        try:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, json.dumps(payload))
        except RuntimeError:  # the loop is closing
            pass

    async def close(self) -> None:
        self._queue.put_nowait(None)
        try:
            await asyncio.wait_for(self._task, timeout=2)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            self._task.cancel()


class _FrameSink:
    """Turns captured program output into ``output`` / ``stderr`` frames (or buffers them for a parse)."""

    def __init__(self, sender: _Sender, run_id: str | None, buffered: bool):
        self._sender, self._run_id, self.buffered = sender, run_id, buffered
        self.frames: list[dict] = []

    def _emit(self, frame: dict) -> None:
        if self._run_id:
            frame["run_id"] = self._run_id
        if self.buffered:
            self.frames.append(frame)
        else:
            self._sender.send_from_thread(frame)

    def output(self, stream: str, text: str) -> None:
        self._emit({"type": "stderr" if stream == STDERR else "output", "text": text})

    def truncated(self, dropped_bytes: int) -> None:
        self._emit({
            "type": "output", "text": f"\n[output truncated: {dropped_bytes} more bytes not shown]\n",
            "output_truncated": True, "dropped_bytes": dropped_bytes,
        })

    def release(self) -> None:
        for frame in self.frames:
            self._sender.send(frame)
        self.frames = []


@dataclass
class _Prepared:
    request: RunRequest
    run_id: str | None
    sink: _FrameSink


def _number(value: Any, minimum: float = 0.0) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value > minimum else None


def _limits(raw: Any) -> dict:
    limits = {}
    if isinstance(raw, dict):
        for key in ("wall_s", "memory_mb"):
            value = _number(raw.get(key))
            if value is not None:
                limits[key] = int(value) if key == "memory_mb" else value
    return limits


def _seed(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _parameter_values(raw: Any) -> dict | None:
    if not isinstance(raw, dict) or not raw:
        return None
    if all(isinstance(k, str) and isinstance(v, (int, float)) and not isinstance(v, bool) for k, v in raw.items()):
        return dict(raw)
    return None


class RunRoutes:
    """Per-connection router for the pooled message types."""

    def __init__(self, websocket: Any, owner: int, loop: asyncio.AbstractEventLoop):
        self.owner = owner
        self.sender = _Sender(websocket, loop)
        self.last_stim_text: str | None = None
        self._tasks: set[asyncio.Task] = set()

    # -- connection lifecycle ---------------------------------------------

    def dispatch(self, msg_type: str, msg: dict) -> None:
        """Start handling one routed message; returns at once (the reply is a task)."""
        if msg_type == "run_cancel":
            self._cancel(msg)
            return
        task = asyncio.get_running_loop().create_task(self._guarded(msg_type, msg))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def aclose(self) -> None:
        """The connection closed: cancel every request it still has in flight."""
        if run_worker.pool_started():
            run_worker.get_pool().release_owner(self.owner)
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.sender.close()

    async def _guarded(self, kind: str, msg: dict) -> None:
        try:
            await getattr(self, f"_{kind}")(msg)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a bug in one route must not close the socket
            logger.exception("routed %s failed", kind)
            error = KernelError(code=f"{PHASES[kind]}_internal", message=f"{type(exc).__name__}: {exc}"[:500])
            self._fail(kind, error.to_dict(), msg.get("run_id") if isinstance(msg.get("run_id"), str) else None)

    # -- shared pieces ------------------------------------------------------

    def _send(self, payload: dict, run_id: str | None) -> None:
        if run_id:
            payload["run_id"] = run_id
        self.sender.send(payload)

    def _fail(self, kind: str, error: dict, run_id: str | None) -> None:
        """The error frame plus the terminal frame the op's clients wait for."""
        self._send(error_payload(KernelError.from_dict(error), PHASES[kind]), run_id)
        terminal = TERMINAL_FRAMES.get(kind)
        if terminal is not None:
            self._send(dict(terminal), run_id)

    def _prepare(self, kind: str, msg: dict, op: str, *, cached: bool = False, buffered: bool = False) -> _Prepared | None:
        run_id = msg.get("run_id")
        if run_id is not None and not (isinstance(run_id, str) and RUN_ID_PATTERN.match(run_id)):
            self._fail(kind, {"code": "invalid_request", "message": "`run_id` must be 1-128 characters of A-Z a-z 0-9 . _ : -"}, None)
            return None
        spec = run_ops.spec_of(op)
        try:
            paths = project_paths.resolve(
                msg.get("project_root"), msg.get("file_path"), msg.get("run_dir") if kind in RUN_DIR_KINDS else None
            )
        except project_paths.PathError as exc:
            self._fail(kind, {"code": "invalid_path", "message": exc.message, **exc.to_error_fields()}, run_id)
            return None
        params = msg.get("params")
        language = msg.get("language") if isinstance(msg.get("language"), str) else None
        run_dir = paths.run_dir or (self._default_run_dir(run_id) if kind in RUN_DIR_KINDS else None)
        ctx = {
            "language": language, "project_root": paths.project_root, "file_path": paths.file_path, "run_dir": run_dir,
            "params": params if isinstance(params, dict) else {}, "seed": _seed(msg.get("seed")),
            "cache": ("bypass" if msg.get("cache") is False else "use") if cached else "none",
            "limits": _limits(msg.get("limits")),
        }
        request = RunRequest(
            op=op, owner=self.owner, args=self._args(kind, msg), ctx=ctx, run_id=run_id, lane=spec.lane,
            wall_s=spec.wall_s, coalesce="parse" if kind == "parse" else None, streaming=not buffered,
        )
        return _Prepared(request, run_id, _FrameSink(self.sender, run_id, buffered))

    def _default_run_dir(self, run_id: str | None) -> str:
        path = os.path.join(tempfile.gettempdir(), "nuclei-runs", f"{self.owner}-{run_id or int(time.time() * 1000)}")
        os.makedirs(path, exist_ok=True)
        return path

    @staticmethod
    def _args(kind: str, msg: dict) -> dict:
        code = msg.get("code")
        args: dict[str, Any] = {"code": code if isinstance(code, str) else "", "language": msg.get("language")}
        if kind == "execute":
            args.update(
                shots=msg.get("shots", 1024), params=msg.get("params") if isinstance(msg.get("params"), dict) else None,
                seed=_seed(msg.get("seed")), parameter_values=_parameter_values(msg.get("parameter_values")),
                simulation_method=MPS_METHOD if msg.get("simulation_method") == MPS_METHOD else None,
                limits=_limits(msg.get("limits")),
            )
        elif kind == "transpile":
            args.update({k: msg.get(k) for k in ("basis_gates", "coupling_map", "optimization_level")})
        elif kind == "qec_snapshot":
            args["max_edges"] = _seed(msg.get("max_edges"))
            if isinstance(msg.get("circuit_text"), str):
                args["circuit_text"] = msg["circuit_text"]
        elif kind == "qec_materialize":
            args["noise"] = msg.get("noise") if isinstance(msg.get("noise"), dict) else None
        elif kind == "qec_estimate":
            args.update(language=msg.get("language", "qsharp"), options=msg.get("options") if isinstance(msg.get("options"), dict) else None)
        return args

    async def _submit(self, kind: str, prepared: _Prepared) -> PoolResult | None:
        try:
            future = run_worker.get_pool().submit(prepared.request, prepared.sink)
        except DuplicateRunId:
            self._fail(kind, {"code": "invalid_request", "message": "That `run_id` is already running."}, prepared.run_id)
            return None
        return await asyncio.wrap_future(future)

    # -- run_cancel -----------------------------------------------------------

    def _cancel(self, msg: dict) -> None:
        run_id = msg.get("run_id")
        accepted = (
            isinstance(run_id, str) and run_worker.pool_started() and run_worker.get_pool().cancel(self.owner, run_id)
        )
        self.sender.send({"type": "run_cancelled", "run_id": run_id if isinstance(run_id, str) else None, "accepted": bool(accepted)})

    # -- parse ----------------------------------------------------------------

    async def _parse(self, msg: dict) -> None:
        prepared = self._prepare("parse", msg, "parse", cached=True, buffered=True)
        if prepared is None:
            return
        result = await self._submit("parse", prepared)
        if result is None or result.superseded:
            return  # a newer parse replaced this one: no frames at all
        run_id = prepared.run_id
        prepared.sink.release()
        if result.pool_error:
            self._fail("parse", result.error or {}, run_id)
            return
        reply = result.reply or {}
        snapshot = {"type": "snapshot", "data": reply.get("snapshot")}
        if run_id:
            snapshot.update({k: reply[k] for k in ("preview", "elapsed_ms", "slow") if k in reply})
        self._send(snapshot, run_id)
        self._remember_stim(reply)
        if reply.get("qec") is not None:
            self._send({"type": "qec_snapshot", "data": reply["qec"]}, run_id)
        if result.error:
            self._send(error_payload(KernelError.from_dict(result.error), "parse"), run_id)

    def _remember_stim(self, reply: dict) -> None:
        if "stim_text" in reply:
            self.last_stim_text = reply["stim_text"]

    # -- execute --------------------------------------------------------------

    async def _execute(self, msg: dict) -> None:
        prepared = self._prepare("execute", msg, "execute")
        if prepared is None:
            return
        result = await self._submit("execute", prepared)
        if result is None:
            return
        run_id = prepared.run_id
        if result.pool_error:
            self._fail("execute", result.error or {}, run_id)
            return
        reply = result.reply or {}
        error = result.error
        if reply.get("snapshot") or (error and error.get("code") in SNAPSHOT_ERROR_CODES):
            self._send({"type": "snapshot", "data": reply.get("snapshot")}, run_id)
        self._remember_stim(reply)
        if reply.get("qec") is not None and not error:
            self._send({"type": "qec_snapshot", "data": reply["qec"]}, run_id)
        if error:
            self._fail("execute", error, run_id)
            return
        self._send_result(reply, result, run_id)

    def _send_result(self, reply: dict, result: PoolResult, run_id: str | None) -> None:
        data = reply.get("result")
        if run_id and isinstance(data, dict) and reply.get("run_dir"):
            data["run_dir"] = reply["run_dir"]
        frame: dict[str, Any] = {"type": "result", "data": data}
        if run_id:
            frame["run_id"] = run_id
        started = time.perf_counter()
        text = json.dumps(frame)
        if run_id:
            serialize_ms = round((time.perf_counter() - started) * 1000, 1)
            simulate_ms = float((data or {}).get("execution_time_ms") or 0.0) if isinstance(data, dict) else 0.0
            timing = {**result.timing, "simulate_ms": simulate_ms, "serialize_ms": serialize_ms}
            text = text[:-1] + ',"timing":' + json.dumps(timing) + "}"
        self.sender.send_text(text)

    # -- run_python -------------------------------------------------------------

    async def _run_python(self, msg: dict) -> None:
        prepared = self._prepare("run_python", msg, "run_python")
        if prepared is None:
            return
        result = await self._submit("run_python", prepared)
        if result is None:
            return
        run_id = prepared.run_id
        if result.pool_error:
            self._fail("run_python", result.error or {}, run_id)
            return
        if result.error:
            self._send(error_payload(KernelError.from_dict(result.error), PHASES["run_python"]), run_id)
        frame: dict[str, Any] = {"type": "python_result", "success": result.error is None}
        figures = (result.reply or {}).get("figures")
        if figures:
            frame["figures"] = figures
        self._send(frame, run_id)

    # -- the data-returning preview ops --------------------------------------------

    async def _data_op(self, kind: str, msg: dict, op: str, reply_type: str, *, cached: bool = True) -> None:
        prepared = self._prepare(kind, msg, op, cached=cached, buffered=True)
        if prepared is None:
            return
        result = await self._submit(kind, prepared)
        if result is None or result.superseded:
            return
        prepared.sink.release()
        if result.pool_error or result.error:
            self._fail(kind, result.error or {}, prepared.run_id)
            return
        self._send({"type": reply_type, "data": (result.reply or {}).get("data")}, prepared.run_id)

    async def _transpile(self, msg: dict) -> None:
        await self._data_op("transpile", msg, "transpile", "transpile_result")

    async def _debug_trace(self, msg: dict) -> None:
        await self._data_op("debug_trace", msg, "debug_trace", "debug_trace_result")

    async def _qec_estimate(self, msg: dict) -> None:
        await self._data_op("qec_estimate", msg, "qec_estimate", "qec_estimate_result", cached=False)

    async def _qec_snapshot(self, msg: dict) -> None:
        if isinstance(msg.get("code"), str):
            await self._data_op("qec_snapshot", msg, "qec_snapshot", "qec_snapshot")
            return
        if self.last_stim_text is None:
            self._fail("qec_snapshot", KernelError(
                code="no_circuit", framework="stim",
                message="No Stim circuit available for qec_snapshot — parse or execute one first, or include `code` in the request.",
            ).to_dict(), msg.get("run_id") if isinstance(msg.get("run_id"), str) else None)
            return
        await self._data_op("qec_snapshot", {**msg, "circuit_text": self.last_stim_text}, "qec_snapshot_text", "qec_snapshot", cached=False)

    async def _qec_materialize(self, msg: dict) -> None:
        prepared = self._prepare("qec_materialize", msg, "qec_materialize", cached=True, buffered=True)
        if prepared is None:
            return
        result = await self._submit("qec_materialize", prepared)
        if result is None or result.superseded:
            return
        prepared.sink.release()
        if result.pool_error or result.error:
            self._fail("qec_materialize", result.error or {}, prepared.run_id)
            return
        self._send({"type": "qec_circuits", "circuits": (result.reply or {}).get("circuits")}, prepared.run_id)

    # -- hardware submission (called by the server's hardware_submit branch) -----------

    async def simulate_for_hardware(self, msg: dict, code: str, shots: int, language: str | None) -> Any:
        """Run the program on the run lane; returns the ``PrecomputedRun`` the simulator provider stores."""
        from kernel.hardware.simulator_provider import PrecomputedRun

        request = RunRequest(
            op="execute", owner=self.owner, lane=run_ops.RUN, wall_s=run_ops.spec_of("execute").wall_s, streaming=False,
            args={"code": code, "shots": shots, "language": language, "limits": _limits(msg.get("limits"))},
            ctx=self._hardware_ctx(msg, language),
        )
        result = await asyncio.wrap_future(run_worker.get_pool().submit(request))
        if result.pool_error:
            return PrecomputedRun(error=result.error)
        reply = result.reply or {}
        return PrecomputedRun(result=reply.get("result"), error=result.error)

    async def prepare_python_circuit(self, msg: dict, code: str, provider: str, language: str | None) -> Any:
        """Run the program on the run lane and rebuild the circuit it defines for ``provider.submit_job``."""
        from kernel import run_hardware

        request = RunRequest(
            op="hardware_prepare", owner=self.owner, lane=run_ops.RUN, wall_s=run_ops.spec_of("hardware_prepare").wall_s,
            streaming=False, args={"code": code, "provider": provider, "language": language},
            ctx=self._hardware_ctx(msg, language),
        )
        result = await asyncio.wrap_future(run_worker.get_pool().submit(request))
        if result.error is not None:
            raise RuntimeError(result.error.get("message", "The program could not be prepared for hardware."))
        return run_hardware.deserialize_circuit((result.reply or {})["circuit"])

    def _hardware_ctx(self, msg: dict, language: str | None) -> dict:
        paths = project_paths.resolve(msg.get("project_root"), msg.get("file_path"), None)
        return {
            "language": language, "project_root": paths.project_root, "file_path": paths.file_path,
            "run_dir": self._default_run_dir(None), "params": {}, "cache": "none", "limits": _limits(msg.get("limits")),
        }
