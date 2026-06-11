"""Q# adapter — compiles and simulates Q# source via the Microsoft QDK.

Q# is a source-mode framework: source text goes straight to the qdk
interpreter and NEVER reaches Python exec(). The executor delegates
wholesale to parse_source / execute_source instead of running the
exec-then-inspect pipeline used by the Python frameworks.

The qdk interpreter is process-global, so every public method starts with
a fresh qsharp.init(...) to avoid state leaking between calls. Beyond being
process-global, the interpreter context is a pyo3 *unsendable* object —
pinned to the thread that created it. Dropping it from any other thread
(which is exactly what a cross-thread qsharp.init() does) raises an
unraisable RuntimeError and leaks the foreign-thread context. Every
interpreter touch therefore runs on ONE dedicated thread (_QSHARP_EXECUTOR),
which both serializes calls and guarantees contexts are created and dropped
on the same thread.

The single thread has a failure mode: qdk offers NO cancellation, so a
runaway Q# program (an infinite loop) occupies the interpreter thread
forever, and every later call queues silently behind it while the kernel
looks healthy. A watchdog timeout on the caller's future (see
_on_interpreter_thread) cannot recover the thread — it can only free the
caller and make the wedged state legible: timed-out calls surface a
`timeout` KernelError, the module marks the interpreter wedged, and
subsequent calls fail fast (instead of waiting a full budget each) until
the runaway task finishes — at which point the queue drains and the wedge
clears itself. The only real recovery is a kernel restart.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import traceback
from collections.abc import Callable, Mapping
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from typing import Any, TypeVar

from kernel.adapters._math import assign_layer, partial_trace_qubit
from kernel.adapters.base import FrameworkAdapter
from kernel.models.errors import KernelError
from kernel.models.snapshot import CircuitSnapshot, Gate, SimulationResult

# Microsoft's qdk package ships usage telemetry to Azure Application
# Insights, enabled by default and configured at import time. Nuclei opts
# its users out; setdefault means anyone who explicitly exported
# QDK_PYTHON_TELEMETRY before launch keeps their own choice.
os.environ.setdefault("QDK_PYTHON_TELEMETRY", "none")

try:
    from qdk import qsharp

    QSHARP_AVAILABLE = True
except ImportError:
    qsharp = None
    QSHARP_AVAILABLE = False


# why: the qdk interpreter is process-global (one default interpreter context
# per process, qdk._interpreter._default_context) AND thread-pinned: the
# context is a pyo3 unsendable object, so dropping it from a thread other
# than the one that created it raises an unraisable RuntimeError and leaks
# the context. server.py runs parse/execute via asyncio.to_thread (a
# multi-thread pool), so consecutive calls would otherwise land on different
# threads and leak a context on every cross-thread init. This single-worker
# executor pins ALL interpreter access (init/eval/circuit/run/compile) to
# one long-lived thread; max_workers=1 also serializes every
# init → eval → [circuit | run | compile] critical section, so no separate
# lock is needed. The worker thread is only spawned on first submit.
_QSHARP_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qsharp-interp")

_T = TypeVar("_T")


# ───────── watchdog budgets ─────────
# Differentiated on purpose: parse/compile run the Q# COMPILER only — fast
# for any real source file, so the budget is tight. Execute runs the user's
# PROGRAM at the user's shot count, so its budget is generous. Both are
# module constants (and per-call overridable via the methods' `timeout`
# kwarg) so tests can inject tiny budgets instead of waiting 30s.
QSHARP_COMPILE_TIMEOUT_SECONDS: float = 30.0
QSHARP_EXECUTE_TIMEOUT_SECONDS: float = 300.0


class _WatchdogError(Exception):
    """Base for watchdog failures raised by _on_interpreter_thread.

    str(exc) is the full student-readable message; the public methods map
    it to KernelError(code="timeout") or RuntimeError as their contracts
    require.
    """


class _WatchdogTimeout(_WatchdogError):
    """The caller's budget expired; the task may still be running."""


class _InterpreterWedged(_WatchdogError):
    """A previously timed-out task still occupies the interpreter thread."""


def _timeout_message(budget: float | None) -> str:
    return (
        f"Q# took longer than {budget:g} seconds, so Nuclei stopped waiting "
        "— but the program is still running: qdk cannot cancel it, so the "
        "Q# interpreter stays busy until the kernel restarts. Check your "
        "code for infinite loops, then restart the kernel."
    )


_WEDGED_MESSAGE = (
    "A previous Q# run timed out and is still occupying the interpreter, "
    "so this request cannot run. Restart the kernel to recover, and check "
    "the earlier program for infinite loops."
)

# why: a timed-out task cannot be cancelled (qdk has no cancellation), so it
# keeps the single interpreter thread busy and every later submit would
# queue behind it and time out too — silently, one full budget at a time.
# This counter makes that state legible: >0 means wedged, and new calls
# fail fast in _on_interpreter_thread instead of queueing. It counts (rather
# than flags) because a tight race can leave more than one timed-out task
# in flight; the wedge must hold until ALL of them have drained.
_WEDGE_LOCK = threading.Lock()
_wedged_count = 0


def _interpreter_wedged() -> bool:
    with _WEDGE_LOCK:
        return _wedged_count > 0


def _mark_wedged(future: Future) -> None:
    global _wedged_count
    with _WEDGE_LOCK:
        _wedged_count += 1
    # The done-callback clears the wedge when the runaway task FINISHES —
    # the queue then drains normally, so Q# works again without a restart.
    # Registered after the increment: if the task completed in the race
    # window after the timeout, the callback fires synchronously here and
    # the net count is zero, as it should be.
    future.add_done_callback(_clear_wedged)


def _clear_wedged(_future: Future) -> None:
    global _wedged_count
    with _WEDGE_LOCK:
        _wedged_count = max(0, _wedged_count - 1)


def _on_interpreter_thread(fn: Callable[[], _T], timeout: float | None = None) -> _T:
    """Run fn on the dedicated interpreter thread and block for its result.

    Safe with respect to deadlock: the caller (typically an
    asyncio.to_thread worker) and the qsharp-interp worker are independent
    threads. Exceptions raised by fn (e.g. ImportError("qdk")) propagate to
    the caller via .result(). fn must materialize everything it returns into
    plain Python data — nothing qdk-owned may escape the interpreter thread.
    NEVER call the public adapter methods from within fn itself: the single
    worker would self-deadlock.

    timeout is the watchdog budget in seconds (None waits forever). qdk
    offers no cancellation, so on expiry only the CALLER is freed: fn keeps
    running on the interpreter thread, the module marks the interpreter
    wedged (raising _WatchdogTimeout), and subsequent calls raise
    _InterpreterWedged immediately — without submitting — until the runaway
    task completes and the wedge clears itself.
    """
    if _interpreter_wedged():
        raise _InterpreterWedged(_WEDGED_MESSAGE)
    future = _QSHARP_EXECUTOR.submit(fn)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        # cancel() succeeds only if fn never STARTED (it was queued behind
        # another task in a race window) — then it will never occupy the
        # thread and must not count toward the wedge; whatever is actually
        # occupying the thread is tracked by its own caller's timeout.
        if not future.cancel():
            _mark_wedged(future)
        raise _WatchdogTimeout(_timeout_message(timeout)) from None


def _dispose_qdk_thread_state() -> None:
    """Drop thread-pinned qdk globals on the interpreter thread at exit.

    qdk parks its Context (holding the pyo3 Interpreter) in
    qdk._interpreter._default_context and GlobalCallable wrappers in the
    qdk.code module. All of those are pinned to the interpreter thread; if
    interpreter finalization tore them down from the main thread instead,
    pyo3 would print "RuntimeError: ... is unsendable, but is being dropped
    on another thread" to stderr at every process exit. This hook is
    registered via threading._register_atexit, which fires before
    concurrent.futures' own join hook — so the executor still accepts the
    dispose task. Best effort: qdk internals may change shape, and failing
    here must never break process exit (worst case is the old stderr noise).
    """

    def _dispose() -> None:
        from qdk import _interpreter as qdk_interpreter

        qdk_interpreter._clear_code_module()
        qdk_interpreter._default_context = None

    try:
        _QSHARP_EXECUTOR.submit(_dispose).result()
    except Exception:
        pass


if QSHARP_AVAILABLE:
    threading._register_atexit(_dispose_qdk_thread_state)


# Zero-parameter operations are the only runnable entry points: `Name()`.
_ZERO_PARAM_OP = re.compile(r"operation\s+(\w+)\s*\(\s*\)\s*:", re.MULTILINE)

# Circuit-JSON gate names that map onto canonical names unchanged
# (when uncontrolled — controlled X/Z become CNOT/Toffoli/CZ below).
_PASSTHROUGH_GATES = {"H", "X", "Y", "Z", "S", "T", "SWAP"}
_ROTATION_GATES = {"Rx": "RX", "Ry": "RY", "Rz": "RZ"}

_NO_ENTRY_MESSAGE = (
    "No runnable operation found. Define a zero-parameter operation like "
    "`operation Main() : Result[]`."
)


def _resolve_entry(code: str) -> str | None:
    """Pick the entry expression for a Q# source file.

    Priority: an op named Main, else the LAST defined zero-parameter op
    (matching how students iterate — the newest operation wins), else None.
    """
    names = _ZERO_PARAM_OP.findall(code)
    if not names:
        return None
    if "Main" in names:
        return "Main()"
    return f"{names[-1]}()"


def _short_diagnostic(text: str) -> str:
    """Extract the one-line human summary from a miette-rendered diagnostic.

    The renderer marks the summary with a leading `x ` (e.g. "x syntax
    error"); fall back to the first non-blank line for other shapes.
    """
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    for line in lines:
        if line.startswith("x "):
            return line[2:].strip()
    return lines[0] if lines else "Q# error."


def _short_traceback_message(tb: str) -> str:
    """Last non-blank line of a Python traceback — same as the executor."""
    lines = [line.strip() for line in tb.strip().splitlines() if line.strip()]
    return lines[-1] if lines else "Q# adapter failed."


def _gate_params(component: dict) -> list[float]:
    """Parse the formatted-string args (e.g. "1.5708") into floats.

    Non-numeric args (rare, display-only) are skipped rather than failing
    the whole snapshot.
    """
    params: list[float] = []
    for arg in component.get("args", []):
        try:
            params.append(float(arg))
        except (TypeError, ValueError):
            continue
    return params


def _map_unitary(component: dict) -> Gate:
    """Map a circuit-JSON unitary component to a canonical Gate."""
    name = component.get("gate", "")
    targets = [t["qubit"] for t in component.get("targets", []) if "qubit" in t]
    controls = [c["qubit"] for c in component.get("controls", []) if "qubit" in c]
    is_adjoint = bool(component.get("isAdjoint"))

    if name == "X" and len(controls) == 1:
        gate_type = "CNOT"
    elif name == "X" and len(controls) == 2:
        gate_type = "Toffoli"
    elif name == "Z" and len(controls) == 1:
        gate_type = "CZ"
    elif name in _ROTATION_GATES:
        # isAdjoint on rotations is assumed to be represented by qdk in the
        # emitted angle args (the adjoint shows up as a negated angle), so
        # the flag is deliberately not applied again here — doing so would
        # double-invert the rotation.
        gate_type = _ROTATION_GATES[name]
    elif name in ("S", "T") and is_adjoint:
        gate_type = f"{name}dg"
    elif name in _PASSTHROUGH_GATES:
        gate_type = name
    else:
        # Unknown gates pass through uppercased (controls preserved); the
        # renderer draws unrecognized types as labeled boxes.
        gate_type = name.upper()

    return Gate(
        type=gate_type,
        targets=targets,
        controls=controls,
        params=_gate_params(component),
    )


def _snapshot_from_circuit_json(data: dict) -> CircuitSnapshot:
    """Convert qsharp.circuit(...).json() output into a CircuitSnapshot.

    Components are flattened in grid order and re-layered with the shared
    greedy algorithm (NOT the native column indices) so Q# circuits lay
    out identically to qiskit ones in the renderer.
    """
    gates: list[Gate] = []
    qubit_layers: dict[int, int] = {}
    measure_count = 0

    for column in data.get("componentGrid", []):
        for component in column.get("components", []):
            kind = component.get("kind")
            if kind == "unitary":
                gate = _map_unitary(component)
            elif kind == "measurement":
                # Measurements list their qubits under "qubits", not "targets".
                targets = [
                    q["qubit"] for q in component.get("qubits", []) if "qubit" in q
                ]
                gate = Gate(type="Measure", targets=targets)
                measure_count += 1
            elif kind == "ket":
                # |0> preparation mid-circuit is a reset.
                targets = [
                    t["qubit"] for t in component.get("targets", []) if "qubit" in t
                ]
                gate = Gate(type="Reset", targets=targets)
            else:
                # Unknown component kinds are skipped defensively.
                continue

            gate.layer = assign_layer(qubit_layers, gate.controls + gate.targets)
            gates.append(gate)

    return CircuitSnapshot(
        framework="qsharp",
        qubit_count=len(data.get("qubits", [])),
        classical_bit_count=measure_count,
        depth=max(qubit_layers.values()) if qubit_layers else 0,
        gates=gates,
    )


def _flatten_results(value) -> list[int]:
    """Recursively collect measurement bits from a shot's return value.

    Q# entry points can return a single Result, Result[], or nested
    tuples/arrays — flatten them all in encounter order.
    """
    if isinstance(value, (list, tuple)):
        bits: list[int] = []
        for item in value:
            bits.extend(_flatten_results(item))
        return bits
    if QSHARP_AVAILABLE and isinstance(value, qsharp.Result):
        return [int(value)]
    return []


class QsharpAdapter(FrameworkAdapter):
    """Source-mode adapter: parse/simulate Q# through the qdk interpreter."""

    def detect(self, code: str) -> bool:
        return bool(
            re.search(
                r"^\s*(namespace\s+[\w.]+|operation\s+\w+\s*\(|import\s+Std|open\s+Microsoft\.Quantum)",
                code,
                re.MULTILINE,
            )
        )

    # Source-mode adapters never participate in the exec-based pipeline.

    def find_circuit(self, namespace: dict):
        raise NotImplementedError("QsharpAdapter is source-mode; use parse_source")

    def extract_snapshot(self, circuit_obj) -> CircuitSnapshot:
        raise NotImplementedError("QsharpAdapter is source-mode; use parse_source")

    def simulate(self, circuit_obj, shots: int) -> SimulationResult:
        raise NotImplementedError("QsharpAdapter is source-mode; use execute_source")

    # ───────── source-mode pipeline ─────────

    def parse_source(
        self, code: str, *, timeout: float | None = None
    ) -> tuple[CircuitSnapshot | None, str, str, KernelError | None]:
        """Compile Q# source and return (snapshot, stdout, stderr, error).

        timeout overrides QSHARP_COMPILE_TIMEOUT_SECONDS (tests inject tiny
        budgets here). On expiry — or while a previous timed-out run still
        occupies the interpreter — the error is KernelError(code="timeout").

        Raises ImportError("qdk") when the QDK is not installed — the
        executor maps that to a missing_dependency KernelError. All other
        failures are returned as KernelErrors, never raised.
        """
        budget = QSHARP_COMPILE_TIMEOUT_SECONDS if timeout is None else timeout
        # why: the interpreter is process-global and thread-pinned — the
        # whole init → eval → circuit sequence runs as one task on the
        # dedicated interpreter thread, and only plain-data results (the
        # snapshot is built from the circuit's JSON string inside the task)
        # cross back to this thread.
        try:
            snapshot, _entry, error = _on_interpreter_thread(
                lambda: self._compile_and_snapshot(code), timeout=budget
            )
        except _WatchdogError as exc:
            return None, "", "", KernelError(
                code="timeout", message=str(exc), framework="qsharp"
            )
        if error is not None:
            return None, "", "", error
        # No runnable operation is NOT an error during parse — students see
        # a quiet empty circuit while live-typing, same as the Python path.
        return snapshot, "", "", None

    def execute_source(
        self, code: str, shots: int, *, timeout: float | None = None
    ) -> tuple[
        SimulationResult | None, CircuitSnapshot | None, str, str, KernelError | None
    ]:
        """Compile + simulate Q# source; returns
        (result, snapshot, stdout, stderr, error).

        timeout overrides QSHARP_EXECUTE_TIMEOUT_SECONDS — generous,
        because this runs the user's program at the user's shot count. On
        expiry — or while a previous timed-out run still occupies the
        interpreter — the error is KernelError(code="timeout").

        Raises ImportError("qdk") when the QDK is not installed — the
        executor maps that to a missing_dependency KernelError. All other
        failures are returned as KernelErrors, never raised.
        """
        if not isinstance(shots, int) or shots < 1:
            return None, None, "", "", KernelError(
                code="execution_error",
                message=f"shots must be a positive integer, got {shots!r}.",
                framework="qsharp",
            )

        # why: compile (init/eval) and run must execute as ONE task on the
        # dedicated interpreter thread — the interpreter is process-global
        # and thread-pinned, and another call's init between our eval and
        # our run would wipe the definitions the run depends on. Result
        # assembly and stdout collection also stay inside the task because
        # shot_results hold interpreter-produced objects (StateDump,
        # qsharp.Result); everything is materialized into plain Python data
        # (floats, dicts, strings) before crossing back to this thread.
        def _pipeline() -> tuple[
            SimulationResult | None,
            CircuitSnapshot | None,
            str,
            str,
            KernelError | None,
        ]:
            snapshot, entry, error = self._compile_and_snapshot(code)
            if error is not None:
                return None, None, "", "", error
            if entry is None or snapshot is None:
                return None, None, "", "", KernelError(
                    code="no_circuit",
                    message=_NO_ENTRY_MESSAGE,
                    framework="qsharp",
                )

            start = time.time()
            try:
                shot_results = qsharp.run(entry, shots=shots, save_events=True)
            except Exception as exc:
                return None, snapshot, "", "", self._runtime_error(exc)

            result = self._build_result(snapshot, shot_results, shots, start)
            stdout = self._collect_stdout(shot_results)
            return result, snapshot, stdout, "", None

        budget = QSHARP_EXECUTE_TIMEOUT_SECONDS if timeout is None else timeout
        try:
            return _on_interpreter_thread(_pipeline, timeout=budget)
        except _WatchdogError as exc:
            return None, None, "", "", KernelError(
                code="timeout", message=str(exc), framework="qsharp"
            )

    def compile_qir(
        self, code: str, target_profile: str, *, timeout: float | None = None
    ) -> object:
        """Compile Q# source to QIR for hardware submission (Phase D).

        Returns the qdk QirInputData object itself: it satisfies the
        `_repr_qir_` QIR protocol (plus `_name` for the entrypoint) that
        azure-quantum's `target.submit` uses to detect QIR payloads — a
        stringified form would not be recognized as QIR downstream.

        The init is restored to Unrestricted in a finally block because the
        interpreter is process-global — leaving a restricted profile active
        would break the next parse/execute call. NOTE: on a watchdog
        timeout that finally has not run yet — it runs whenever the wedged
        task eventually finishes, which may be never (kernel restart).

        timeout overrides QSHARP_COMPILE_TIMEOUT_SECONDS (compiler-only
        work, same tight budget as parse_source).

        Raises:
            ImportError: with a full human-readable message when the QDK is
                not installed. Unlike parse_source/execute_source there is no
                executor wrapper mapping a bare module name to a
                missing_dependency error — the server calls this directly.
            ValueError: for an unknown target_profile.
            RuntimeError: when the source fails to compile, has no runnable
                entry point, exceeds the watchdog budget, or a previous
                timed-out run still occupies the interpreter — the server
                wraps the message into "Hardware submit failed: ...".
        """
        if not QSHARP_AVAILABLE:
            raise ImportError(
                "Microsoft QDK (qdk) is not installed in the kernel environment."
            )
        profiles = {
            "base": qsharp.TargetProfile.Base,
            "adaptive_ri": qsharp.TargetProfile.Adaptive_RI,
        }
        if target_profile not in profiles:
            raise ValueError(
                f"Unknown target profile {target_profile!r}; "
                f"expected one of {sorted(profiles)}"
            )

        # why: the interpreter is process-global and thread-pinned — the
        # profile-switching init, eval, compile, AND the finally-init that
        # restores Unrestricted must all run as one task on the dedicated
        # interpreter thread, or another call could interleave its own
        # init/eval and both sessions end up corrupted.
        def _pipeline() -> object:
            try:
                qsharp.init(target_profile=profiles[target_profile])
                try:
                    qsharp.eval(code)
                except qsharp.QSharpError as exc:
                    raise RuntimeError(_short_diagnostic(str(exc))) from exc
                entry = _resolve_entry(code)
                if entry is None:
                    raise RuntimeError(_NO_ENTRY_MESSAGE)
                # QirInputData is a sendable plain-data container (_ll_str,
                # _name, _repr_qir_) — safe to return across threads
                # (verified: no pyo3 unsendable drop warnings).
                return qsharp.compile(entry)
            finally:
                qsharp.init(target_profile=qsharp.TargetProfile.Unrestricted)

        budget = QSHARP_COMPILE_TIMEOUT_SECONDS if timeout is None else timeout
        try:
            return _on_interpreter_thread(_pipeline, timeout=budget)
        except _WatchdogError as exc:
            raise RuntimeError(str(exc)) from exc

    # ───────── internals ─────────

    def _compile_and_snapshot(
        self, code: str
    ) -> tuple[CircuitSnapshot | None, str | None, KernelError | None]:
        """Init the interpreter, eval the source, and build a snapshot.

        Callers MUST run this on the dedicated interpreter thread (via
        _on_interpreter_thread) — it touches the process-global,
        thread-pinned interpreter (init/eval/circuit) directly. The returned
        snapshot is plain Python data (the circuit's JSON string is parsed
        here, inside the interpreter thread).

        Returns (snapshot, entry_expr, error). A (None, None, None) result
        means the source compiled but has no runnable entry point.
        Raises ImportError("qdk") when the QDK is not installed.
        """
        if not QSHARP_AVAILABLE:
            raise ImportError("qdk")

        qsharp.init(target_profile=qsharp.TargetProfile.Unrestricted)
        try:
            qsharp.eval(code)
        except qsharp.QSharpError as exc:
            diagnostic = str(exc)
            return None, None, KernelError(
                code="compile_error",
                message=_short_diagnostic(diagnostic),
                traceback=diagnostic,
                framework="qsharp",
            )

        entry = _resolve_entry(code)
        if entry is None:
            return None, None, None

        try:
            circuit = qsharp.circuit(entry, group_by_scope=False)
            snapshot = _snapshot_from_circuit_json(json.loads(circuit.json()))
        except Exception:
            tb = traceback.format_exc()
            return None, entry, KernelError(
                code="adapter_error",
                message=_short_traceback_message(tb),
                traceback=tb,
                framework="qsharp",
            )

        return snapshot, entry, None

    def _runtime_error(self, exc: Exception) -> KernelError:
        """Map a qsharp.run failure to an execution_error KernelError."""
        if isinstance(exc, qsharp.QSharpError):
            diagnostic = str(exc)
            message = _short_diagnostic(diagnostic)
        else:
            diagnostic = traceback.format_exc()
            message = _short_traceback_message(diagnostic)
        return KernelError(
            code="execution_error",
            message=message,
            traceback=diagnostic,
            framework="qsharp",
        )

    def _build_result(
        self,
        snapshot: CircuitSnapshot,
        # Each element is a qdk ShotResult TypedDict (qdk._types.ShotResult);
        # annotated structurally so this module never imports qdk types at
        # runtime when the package is unavailable.
        shot_results: list[Mapping[str, Any]],
        shots: int,
        start: float,
    ) -> SimulationResult:
        """Assemble a SimulationResult from per-shot qdk run output."""
        n_qubits = snapshot.qubit_count

        # Sampled counts from each shot's returned Result values.
        shot_bits = [_flatten_results(shot.get("result")) for shot in shot_results]
        measurements: dict[str, int] = {}
        for bits in shot_bits:
            if not bits:
                continue
            bitstring = "".join(str(b) for b in bits)
            measurements[bitstring] = measurements.get(bitstring, 0) + 1
        probabilities = {k: v / shots for k, v in measurements.items()}

        # Exact state (best effort): the last DumpMachine of the first shot.
        # Replaces sampled probabilities with exact ones when available.
        dumps = (shot_results[0].get("dumps") or []) if shot_results else []
        dump = dumps[-1] if dumps else None

        state_vector: list[dict] = []
        bloch_coords: list[dict] = []
        if dump is not None and dump.qubit_count == n_qubits:
            # qdk dense states are big-endian (qubit 0 = MSB of the index),
            # so format(i, ...) puts qubit 0 leftmost — the same convention
            # the cirq adapter and Q#'s own DumpMachine display use.
            dense = dump.as_dense_state()
            state_vector = [
                {"re": float(c.real), "im": float(c.imag)} for c in dense
            ]
            probabilities = {
                format(i, f"0{n_qubits}b"): float(abs(c) ** 2)
                for i, c in enumerate(dense)
                if abs(c) ** 2 > 1e-10
            }
            for i in range(n_qubits):
                rho = partial_trace_qubit(dense, n_qubits, i)
                x = 2 * rho[0, 1].real
                y = 2 * rho[0, 1].imag
                z = (rho[0, 0] - rho[1, 1]).real
                bloch_coords.append({"x": float(x), "y": float(y), "z": float(z)})
        else:
            # No dump: bloch from measurement marginals — only z is
            # observable from counts, so x = y = 0.
            for i in range(n_qubits):
                column = [bits[i] for bits in shot_bits if len(bits) > i]
                if column:
                    p1 = sum(column) / len(column)
                    bloch_coords.append({"x": 0.0, "y": 0.0, "z": float(1 - 2 * p1)})
                else:
                    bloch_coords.append({"x": 0.0, "y": 0.0, "z": 0.0})

        return SimulationResult(
            state_vector=state_vector,
            probabilities=probabilities,
            measurements=measurements,
            bloch_coords=bloch_coords,
            execution_time_ms=round((time.time() - start) * 1000, 1),
            shot_count=shots,
        )

    def _collect_stdout(self, shot_results: list[Mapping[str, Any]]) -> str:
        """Join the first shot's Message() output and DumpMachine state text."""
        if not shot_results:
            return ""
        first = shot_results[0]
        parts = list(first.get("messages") or [])
        parts.extend(str(d) for d in first.get("dumps") or [])
        return "\n".join(parts)
