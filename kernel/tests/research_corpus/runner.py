"""Drive one corpus :class:`~.loader.Case` through a real, authenticated kernel.

``run_case`` talks to the kernel exactly as the editor does (``parse`` then
``execute`` over the v2-authenticated WebSocket) and reduces the frames to an
:class:`Observation` the tests compare with ``expected.yaml``. :class:`KernelPool`
keeps one kernel alive across programs and replaces it the moment a program
leaves it unusable (a hang, ``sys.exit``, an OOM kill), so one bad program can
never cascade into the rest of the run.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from collections.abc import Mapping

from kernel.tests._kernel_client import Kernel, connect, drain, exchange, memory_limit_supported

from .loader import DEFAULT_SHOTS, Case

PROBE_CODE = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\n"
PROBE_TIMEOUT_SECONDS = 10.0
PARSE_IDLE_SECONDS = 0.25
EXECUTE_IDLE_SECONDS = 0.1
PROJECT_TOKEN = "$PROJECT"


@dataclass(frozen=True)
class Observation:
    parse: str | None = None
    execute: str | None = None
    healthy_after: bool = True
    execute_seconds: float | None = None
    max_frame_bytes: int = 0
    facts: Mapping[str, Any] = field(default_factory=dict)
    message: str = ""

    def status(self, phase: str) -> str | None:
        return self.parse if phase == "parse" else self.execute


# -- frame reduction ----------------------------------------------------------


def classify(frames: list[dict[str, Any]]) -> str:
    """``ok`` | ``error[:<code>]`` | ``timeout`` | ``closed`` for one phase's frames."""
    for frame in frames:
        if frame.get("type") == "error":
            code = frame.get("code")
            return f"error:{code}" if code else "error"
    kinds = {frame.get("type") for frame in frames}
    if "__closed__" in kinds:
        return "closed"
    if "__timeout__" in kinds:
        return "timeout"
    return "ok"


def first_error_message(frames: list[dict[str, Any]]) -> str:
    for frame in frames:
        if frame.get("type") == "error":
            return str(frame.get("message", ""))[:300]
    return ""


def _first(frames: list[dict[str, Any]], kind: str) -> dict[str, Any] | None:
    return next((f for f in frames if f.get("type") == kind), None)


def snapshot_facts(frames: list[dict[str, Any]]) -> dict[str, Any] | None:
    frame = _first(frames, "snapshot")
    data = (frame or {}).get("data")
    if not isinstance(data, dict):
        return None
    facts = {k: data[k] for k in ("framework", "qubit_count", "depth") if k in data}
    facts["gates"] = len(data.get("gates") or [])
    return facts


def result_facts(frames: list[dict[str, Any]]) -> dict[str, Any] | None:
    frame = _first(frames, "result")
    data = (frame or {}).get("data")
    if not isinstance(data, dict):
        return None
    facts: dict[str, Any] = {
        "probabilities": len(data.get("probabilities") or {}),
        "measured": sum((data.get("measurements") or {}).values()),
        "bloch": len(data.get("bloch_coords") or []),
        "state_vector": len(data.get("state_vector") or []),
    }
    if data.get("metrics"):
        facts["metrics"] = data["metrics"]
    if "seed_honored" in data:
        facts["seed_honored"] = data["seed_honored"]
    return facts


def facts_mismatches(expected: Mapping[str, Any], observed: Mapping[str, Any]) -> list[str]:
    """Differences between expected golden facts and observed ones (subset match)."""
    problems: list[str] = []
    for group, wanted in expected.items():
        seen = observed.get(group)
        if seen is None:
            problems.append(f"facts.{group}: expected {wanted!r}, phase produced none")
            continue
        for key, want in wanted.items():
            if not _same(want, seen.get(key)):
                problems.append(f"facts.{group}.{key}: expected {want!r}, observed {seen.get(key)!r}")
    return problems


def _same(want: Any, got: Any) -> bool:
    if isinstance(want, Mapping) and isinstance(got, Mapping):
        return want.keys() == got.keys() and all(_same(want[k], got[k]) for k in want)
    if isinstance(want, float) or isinstance(got, float):
        try:
            return math.isclose(float(want), float(got), rel_tol=1e-9, abs_tol=1e-12)
        except (TypeError, ValueError):
            return False
    return want == got


# -- comparing an observation with its golden ----------------------------------

DRIFT_KEYS = ("parse", "execute", "healthy_after")


def compare(case: Case, observed: Observation) -> list[str]:
    """Why ``observed`` is not what ``case`` expects (empty list = it matches)."""
    problems: list[str] = []
    for phase in case.phases:
        want, got = getattr(case, phase), observed.status(phase)
        if want is not None and want != got:
            problems.append(f"{phase}: expected {want!r}, observed {got!r}" + (f" ({observed.message})" if observed.message else ""))
    if observed.healthy_after != case.healthy_after:
        problems.append(f"healthy_after: expected {case.healthy_after}, observed {observed.healthy_after}")
    if case.max_seconds is not None and observed.execute_seconds is not None and observed.execute_seconds > case.max_seconds:
        problems.append(f"execute took {observed.execute_seconds:.2f}s, limit {case.max_seconds}s")
    if case.max_frame_bytes is not None and observed.max_frame_bytes > case.max_frame_bytes:
        problems.append(f"largest frame {observed.max_frame_bytes} bytes, limit {case.max_frame_bytes}")
    if not problems:
        problems.extend(facts_mismatches(case.facts, observed.facts))
    return problems


def drift(case: Case, observed: Observation) -> list[str]:
    """For an ``xfail`` case: differences between today's behaviour and ``xfail.current``.

    A known-bad program that starts failing in a *new* way must not hide behind its
    xfail marker -- the ledger says what the bug looks like, and a change in that
    shape is news. Only the status keys are compared; the rest of ``current`` is
    documentation.
    """
    if case.xfail is None:
        return []
    drifted: list[str] = []
    for key in DRIFT_KEYS:
        if key in case.xfail.current:
            got = observed.healthy_after if key == "healthy_after" else observed.status(key)
            if got != case.xfail.current[key]:
                drifted.append(f"{key}: ledger says {case.xfail.current[key]!r}, observed {got!r}")
    return drifted


# -- does the interpreter match the declared env? -------------------------------

ENV_PROBE = (
    "import importlib.metadata as m, json\n"
    "def v(n):\n"
    "    try: return m.version(n)\n"
    "    except m.PackageNotFoundError: return None\n"
    "print(json.dumps({'qiskit': v('qiskit'), 'qdk': v('qdk'), 'stim': v('stim')}))\n"
)


def probe_env(python: str) -> dict[str, str | None]:
    """Installed versions of the packages that decide a corpus env (run in the kernel's python)."""
    done = subprocess.run([python, "-I", "-c", ENV_PROBE], capture_output=True, text=True, timeout=60, check=True)
    return json.loads(done.stdout)


def env_problems(env: str, facts: Mapping[str, str | None]) -> list[str]:
    """Reasons the interpreter behind ``facts`` cannot stand in for corpus env ``env``."""
    qiskit = facts.get("qiskit")
    major = int(qiskit.split(".")[0]) if qiskit else None
    want_q2 = env == "qk2"
    problems: list[str] = []
    if major is None or (major >= 2) != want_q2:
        problems.append(f"env '{env}' needs Qiskit {'>= 2' if want_q2 else '1.x'}, found {qiskit}")
    if (facts.get("qdk") is None) == (env != "min"):
        problems.append(f"env '{env}' {'needs' if env != 'min' else 'must not have'} qdk, found {facts.get('qdk')}")
    if (facts.get("stim") is not None) != (env == "full"):
        problems.append(f"env '{env}' {'needs' if env == 'full' else 'must not have'} stim, found {facts.get('stim')}")
    return problems


# -- project programs ---------------------------------------------------------


def _substitute(value: Any, project: str) -> Any:
    if isinstance(value, str):
        return value.replace(PROJECT_TOKEN, project)
    if isinstance(value, Mapping):
        return {k: _substitute(v, project) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute(v, project) for v in value]
    return value


def _messages(case: Case, project: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    extra = dict(case.options.get("request") or {})
    if project is not None:
        extra = _substitute(extra, project)
    base = {"code": case.code, "language": case.language, **extra}
    execute = {
        **base,
        "type": "execute",
        "shots": int(case.options.get("shots", DEFAULT_SHOTS)),
    }
    for key in ("params", "seed"):
        if key in case.options:
            execute[key] = case.options[key]
    return {**base, "type": "parse"}, execute


# -- running a case -----------------------------------------------------------


@dataclass(frozen=True)
class PhaseResult:
    status: str
    healthy: bool
    seconds: float
    max_frame_bytes: int
    facts: Mapping[str, Any]
    message: str


async def _probe(ws: Any) -> bool:
    """Does the *same* socket still answer a trivial parse?"""
    frames, _ = await exchange(
        ws, {"type": "parse", "code": PROBE_CODE, "language": "python"}, {"snapshot"}, PROBE_TIMEOUT_SECONDS
    )
    return classify(frames) == "ok"


async def _collect(ws: Any, case: Case, phase: str, parse_message: dict[str, Any], message: dict[str, Any], sizes: list[int]):
    terminal = {"snapshot"} if phase == "parse" else {"result"}
    if phase == "execute":
        for _ in range(int(case.options.get("queued_parses", 0))):
            await ws.send(json.dumps(parse_message))
    frames, seconds = await exchange(ws, message, terminal, case.timeout, sizes)
    if classify(frames) not in ("timeout", "closed"):
        # The kernel may send its `error` frame after the terminal `snapshot`/`result`.
        frames += await drain(ws, PARSE_IDLE_SECONDS if phase == "parse" else EXECUTE_IDLE_SECONDS)
    return frames, classify(frames), seconds


async def run_phase(kernel: Kernel, case: Case, phase: str, project: str | None = None) -> PhaseResult:
    """One phase on its own fresh authenticated connection, then a same-socket probe."""
    parse_message, execute_message = _messages(case, project)
    sizes: list[int] = []
    ws = await connect(kernel)
    try:
        message = parse_message if phase == "parse" else execute_message
        frames, status, seconds = await _collect(ws, case, phase, parse_message, message, sizes)
        healthy = status not in ("timeout", "closed") and await _probe(ws)
    finally:
        try:
            await ws.close()
        except Exception:  # the kernel may already be gone; nothing to close then
            pass
    extract = snapshot_facts if phase == "parse" else result_facts
    extracted = extract(frames)
    return PhaseResult(
        status=status,
        healthy=healthy,
        seconds=seconds,
        max_frame_bytes=max(sizes, default=0),
        facts={} if extracted is None else {"snapshot" if phase == "parse" else "result": extracted},
        message=first_error_message(frames),
    )


def _run_phase_sync(kernel: Kernel, case: Case, phase: str) -> PhaseResult:
    if case.project_dir is None:
        return asyncio.run(run_phase(kernel, case, phase))
    with tempfile.TemporaryDirectory(prefix="nuclei-corpus-project-") as tmp:
        project = Path(tmp) / "project"
        shutil.copytree(case.project_dir, project)
        return asyncio.run(run_phase(kernel, case, phase, str(project)))


# -- kernel lifecycle ---------------------------------------------------------


class KernelPool:
    """One live kernel per distinct DISPLAY, replaced whenever it stops serving."""

    def __init__(self, python: str | None = None, kernel_dir: str | None = None, memory_limit_gb: float = 8) -> None:
        self.python = python or os.environ.get("NUCLEI_CORPUS_PYTHON") or sys.executable
        self.kernel_dir = kernel_dir or os.environ.get("NUCLEI_CORPUS_KERNEL_DIR") or None
        self.memory_limit_gb = memory_limit_gb
        self._kernels: dict[str | None, Kernel] = {}
        self.restarts = 0

    @property
    def memory_limited(self) -> bool:
        return bool(self.memory_limit_gb) and memory_limit_supported()

    def get(self, display: str | None = None) -> Kernel:
        kernel = self._kernels.get(display)
        if kernel is None or not kernel.alive:
            if kernel is not None:
                kernel.stop()
                self.restarts += 1
            kernel = Kernel(self.python, self.kernel_dir, memory_limit_gb=self.memory_limit_gb, display=display)
            kernel.start()
            self._kernels[display] = kernel
        return kernel

    def recycle(self, display: str | None = None) -> None:
        """Kill the kernel for ``display`` so the next ``get`` boots a clean one."""
        kernel = self._kernels.pop(display, None)
        if kernel is not None:
            kernel.stop()
            self.restarts += 1

    def close(self) -> None:
        for kernel in self._kernels.values():
            kernel.stop()
        self._kernels.clear()


def run_pooled(pool: KernelPool, case: Case, display: str | None = None) -> Observation:
    """Run every driven phase of ``case``, recycling the kernel whenever a program broke it."""
    results: dict[str, PhaseResult] = {}
    for phase in case.phases:
        kernel = pool.get(display)
        try:
            results[phase] = _run_phase_sync(kernel, case, phase)
        except Exception:
            pool.recycle(display)
            raise
        if not results[phase].healthy or not kernel.alive:
            pool.recycle(display)
    execute = results.get("execute")
    return Observation(
        parse=results["parse"].status if "parse" in results else None,
        execute=execute.status if execute else None,
        healthy_after=all(r.healthy for r in results.values()),
        execute_seconds=execute.seconds if execute else None,
        max_frame_bytes=max((r.max_frame_bytes for r in results.values()), default=0),
        facts={k: v for r in results.values() for k, v in r.facts.items()},
        message=next((r.message for r in reversed(list(results.values())) if r.message), ""),
    )


# -- Xvfb (the plt.show() gate needs a display that is not the developer's) -----


class XvfbServer:
    """A throwaway virtual X display, or ``None`` when Xvfb is not installed."""

    def __init__(self) -> None:
        self._proc: subprocess.Popen[str] | None = None
        self.display: str | None = None

    def start(self) -> str | None:
        xvfb = shutil.which("Xvfb")
        if xvfb is None:
            return None
        self._proc = subprocess.Popen(
            [xvfb, "-displayfd", "1", "-screen", "0", "640x480x24", "-nolisten", "tcp"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        assert self._proc.stdout is not None
        number = self._proc.stdout.readline().strip()
        if not number.isdigit():
            self.stop()
            return None
        self.display = f":{number}"
        return self.display

    def stop(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None
        self.display = None
