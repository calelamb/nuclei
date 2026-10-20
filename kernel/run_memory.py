"""The memory-estimate policy for simulation (audit R-11, design note section 2.10).

Not a fixed qubit cap: before simulating, estimate the peak memory of the cheapest honest
method (``copies * 2**n * 16`` bytes) and compare it with ``min(25 % of physical RAM, the user's
setting)``.  Above the budget the run is refused *before allocating* with ``too_many_qubits`` and
an "Use Aer MPS / run in the Lab" action.

Scout measurements (GHZ on n qubits, the adapters' full ``simulate``, which builds a Python list
of ``{re, im}`` dicts): n=16 0.1 GB / 1.6 MB frame, n=20 0.6 GB / 25 MB, n=22 2.1 GB / 101 MB,
n=24 7.8 GB / 403 MB.  Above ``FULL_RESULT_MAX_QUBITS`` this module's lean path is used instead:
amplitudes stay in numpy, the state vector is never returned, probabilities are capped, and every
withheld piece is announced in ``truncated``.

TODO(R-A follow-up): fold the lean path into the adapters once R-A's ``SimulationResult`` carries
``truncated``, ``measurements_source`` and ``probabilities_exact`` itself.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass, field

from kernel.models import KernelError, SimulationResult

FULL_RESULT_MAX_QUBITS = 16
MAX_PROBABILITIES = 65_536
AMPLITUDE_BYTES = 16
COPIES_SAMPLED = 2  # Aer/Cirq sampling keeps the state plus one working copy
# Exact probabilities, counted in 16-byte amplitudes: the state, Aer's result copy (2), |amplitude|^2 as
# float64 (0.5), the selection scratch of np.partition (0.5) and the worst-case tie/index array (0.5).
COPIES_EXACT = 4
RAM_FRACTION = 0.25
SIM_MEMORY_ENV = "NUCLEI_SIM_MEMORY_LIMIT_MB"
MPS_METHOD = "matrix_product_state"
NATIVE_FRAMEWORKS = frozenset({"stim", "qsharp"})  # stabilizer / sparse simulators: no 2^n estimate
LEAN_FRAMEWORKS = frozenset({"qiskit", "cirq"})  # the only simulators the lean (numpy-only) path drives
PROBABILITY_FLOOR = 1e-10


def physical_ram_bytes() -> int:
    """Physical RAM, lowered to the container limit (cgroup v2 / v1) when there is one."""
    total = 0
    try:
        total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        total = _windows_ram()
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            with open(path, encoding="ascii") as handle:
                text = handle.read().strip()
        except OSError:
            continue
        if text.isdigit() and 0 < int(text) < (1 << 60):
            total = min(total, int(text)) if total else int(text)
    return total or 8 * (1 << 30)


def _windows_ram() -> int:  # pragma: no cover - Windows only
    if sys.platform != "win32":
        return 0
    import ctypes

    class _Status(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                    ("avail", ctypes.c_ulonglong), ("tpf", ctypes.c_ulonglong), ("apf", ctypes.c_ulonglong),
                    ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("ave", ctypes.c_ulonglong)]

    status = _Status()
    status.length = ctypes.sizeof(status)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))  # type: ignore[attr-defined]
    return int(status.total)


def simulation_budget(memory_limit_mb: int | None = None) -> tuple[int, str]:
    """``(bytes, source)``: ``min(25 % of RAM, setting)``; source is "ram_25pct" or "setting"."""
    ram_budget = int(physical_ram_bytes() * RAM_FRACTION)
    setting = memory_limit_mb
    if setting is None:
        raw = os.environ.get(SIM_MEMORY_ENV, "").strip()
        setting = int(raw) if raw.isdigit() and int(raw) > 0 else None
    if setting is not None and setting > 0 and setting * (1 << 20) < ram_budget:
        return setting * (1 << 20), "setting"
    return ram_budget, "ram_25pct"


@dataclass(frozen=True)
class SimulationPlan:
    qubits: int
    framework: str
    mode: str  # "full" | "lean" | "mps" | "native" | "adapter"
    has_measurements: bool
    copies: int = 0
    estimate_bytes: int = 0
    budget_bytes: int = 0
    budget_source: str = "ram_25pct"

    @property
    def refused(self) -> bool:
        return self.mode == "lean" and self.estimate_bytes > self.budget_bytes


def has_measurements(snapshot) -> bool:
    return any(gate.type == "Measure" for gate in snapshot.gates)


def plan_simulation(
    snapshot, framework: str, *, method: str | None = None, memory_limit_mb: int | None = None
) -> SimulationPlan:
    n = snapshot.qubit_count
    measured = has_measurements(snapshot)
    if framework in NATIVE_FRAMEWORKS:
        return SimulationPlan(n, framework, "native", measured)
    if n <= FULL_RESULT_MAX_QUBITS:
        return SimulationPlan(n, framework, "full", measured)
    if framework not in LEAN_FRAMEWORKS:
        # CUDA-Q (GPU targets, tensor networks) and third-party adapters own their simulation and their
        # memory model: a 2^n x 16 B estimate would be fiction.  The adapter runs; its result is shaped.
        return SimulationPlan(n, framework, "adapter", measured)
    if method == MPS_METHOD and framework == "qiskit" and measured:
        return SimulationPlan(n, framework, "mps", measured)
    copies = COPIES_SAMPLED if measured else COPIES_EXACT
    budget, source = simulation_budget(memory_limit_mb)
    return SimulationPlan(n, framework, "lean", measured, copies, copies * (2 ** n) * AMPLITUDE_BYTES, budget, source)


def _gigabytes(value: int) -> str:
    return f"{value / 1e9:.1f} GB"


def refusal_error(plan: SimulationPlan) -> KernelError:
    where = "25% of RAM" if plan.budget_source == "ram_25pct" else "the memory limit you set"
    actions: list[dict] = []
    if plan.framework == "qiskit" and plan.has_measurements:
        actions.append({"id": "rerun_mps", "label": "Use Aer MPS", "request": {"simulation_method": MPS_METHOD}})
    actions.append({"id": "open_lab", "label": "Run in the Lab"})
    return KernelError(
        code="too_many_qubits",
        message=(
            f"Simulating {plan.qubits} qubits needs about {_gigabytes(plan.estimate_bytes)} "
            f"({plan.copies} copies x 2^{plan.qubits} x 16 B); this kernel allows "
            f"{_gigabytes(plan.budget_bytes)} ({where})."
        ),
        framework=plan.framework,
        extra={
            "estimate": {
                "qubits": plan.qubits, "copies": plan.copies, "bytes": plan.estimate_bytes,
                "budget_bytes": plan.budget_bytes, "budget_source": plan.budget_source, "method": "statevector",
            },
            "actions": actions,
        },
    )


@dataclass
class LeanSimulationResult(SimulationResult):
    """A result whose large parts were withheld; announces what and why (never silent)."""

    truncated: dict | None = None
    measurements_source: str = "none"
    probabilities_exact: bool = False
    extras: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        data = SimulationResult.to_dict(self)
        data.pop("extras", None)
        data.update(self.extras)
        if self.truncated is None:
            data.pop("truncated", None)
        return data


def top_probabilities(probabilities: dict[str, float]) -> tuple[dict[str, float], bool]:
    """The ``MAX_PROBABILITIES`` most probable outcomes (ties by bitstring) and whether any were cut."""
    if len(probabilities) <= MAX_PROBABILITIES:
        return probabilities, False
    ranked = sorted(probabilities.items(), key=lambda item: (-item[1], item[0]))[:MAX_PROBABILITIES]
    return dict(ranked), True


def _truncation(plan: SimulationPlan, probabilities_cut: bool, reason: str) -> dict:
    return {"state_vector": True, "probabilities": probabilities_cut, "reason": reason}


def _empirical(counts: dict[str, int], shots: int) -> dict[str, float]:
    return {bits: count / shots for bits, count in counts.items()} if shots else {}


def _aer_runner():
    """``(prepare, run)`` for Aer: R-A's helpers when merged, else a plain ``optimization_level=0`` transpile.

    Aer only accepts its own basis, so a circuit holding ``EfficientSU2``/``TwoLocal``/``QFT`` blocks
    must be rewritten into it first (audit R-2).  The lean path (above 16 qubits) must behave exactly
    like the adapter path at 16 qubits or fewer, so it goes through the same helper.
    """
    try:
        from kernel.adapters._qiskit_aer import prepare_for_aer, run_on_aer

        return prepare_for_aer, run_on_aer
    except ImportError:
        pass

    def prepare(circuit, backend):
        from qiskit import transpile

        return transpile(circuit, backend, optimization_level=0)

    def run(backend, circuit, shots):
        return backend.run(circuit, shots=shots).result()

    return prepare, run


def _qiskit_sampled(circuit, shots: int, seed: int | None, mps: bool) -> dict[str, int]:
    from qiskit_aer import AerSimulator

    prepare, run = _aer_runner()
    simulator = AerSimulator(method=MPS_METHOD, seed_simulator=seed) if mps else AerSimulator(seed_simulator=seed)
    counts = run(simulator, prepare(circuit, simulator), shots).get_counts()
    return {k: int(v) for k, v in counts.items()}


def _qiskit_exact(circuit, seed: int | None):
    import numpy as np
    from qiskit_aer import AerSimulator

    prepare, run = _aer_runner()
    unmeasured = circuit.copy()
    unmeasured.remove_final_measurements()
    simulator = AerSimulator(method="statevector", seed_simulator=seed)
    prepared = prepare(unmeasured, simulator)
    prepared.save_statevector()
    return np.asarray(run(simulator, prepared, 1).get_statevector().data)


def _cirq_sampled(circuit, shots: int, seed: int | None) -> dict[str, int]:
    import cirq
    import numpy as np

    measured = cirq.Simulator(seed=seed).run(circuit, repetitions=shots).measurements
    counts: dict[str, int] = {}
    if measured:
        combined = np.concatenate([measured[key] for key in sorted(measured)], axis=1)
        for row in combined:
            bits = "".join(str(b) for b in row)
            counts[bits] = counts.get(bits, 0) + 1
    return counts


def _cirq_exact(circuit):
    import cirq
    import numpy as np

    qubits = sorted(circuit.all_qubits())
    stripped = cirq.Circuit(
        op for moment in circuit.moments for op in moment.operations if not isinstance(op.gate, cirq.MeasurementGate)
    )
    return np.asarray(cirq.Simulator().simulate(stripped, qubit_order=qubits).final_state_vector)


def top_indices(probs, limit: int = MAX_PROBABILITIES):
    """``(indices, cut)``: the ``limit`` most probable outcomes above the floor, best first (ties by index).

    Selection happens on the numpy array, so a dense state never becomes 2^n Python objects: only the
    ``limit`` survivors are ever formatted.  ``cut`` says whether anything above the floor was dropped.
    """
    import numpy as np

    live = int(np.count_nonzero(probs > PROBABILITY_FLOOR))
    if live <= limit:
        keep = np.flatnonzero(probs > PROBABILITY_FLOOR)
    else:
        threshold = np.partition(probs, -limit)[-limit]
        above = np.flatnonzero(probs > threshold)
        ties = np.flatnonzero(probs == threshold)[: limit - len(above)]
        keep = np.concatenate([above, ties])
    order = np.lexsort((keep, -probs[keep]))
    return keep[order], live > limit


def _exact_payload(vector, n: int, little_endian: bool) -> tuple[dict[str, float], list[dict], bool]:
    import numpy as np
    from kernel.adapters._math import bloch_coords_from_statevector

    probs = np.abs(vector) ** 2
    keep, cut = top_indices(probs, MAX_PROBABILITIES)
    mapping = {format(int(i), f"0{n}b"): float(probs[i]) for i in keep}
    return mapping, bloch_coords_from_statevector(vector, n, little_endian) if n <= 20 else [], cut


def simulate_lean(circuit, plan: SimulationPlan, shots: int, seed: int | None) -> LeanSimulationResult:
    """Run a circuit above ``FULL_RESULT_MAX_QUBITS`` without ever building a full-amplitude payload."""
    started = time.time()
    n = plan.qubits
    honored = True if seed is not None else None
    if plan.has_measurements:
        mps = plan.mode == "mps"
        counts = _qiskit_sampled(circuit, shots, seed, mps) if plan.framework == "qiskit" else _cirq_sampled(circuit, shots, seed)
        probabilities, cut = top_probabilities(_empirical(counts, shots))
        method = "MPS sampling" if mps else "sampling"
        reason = f"{n} qubits: the state vector is not returned above {FULL_RESULT_MAX_QUBITS} qubits; outcome probabilities are estimated from {shots} shots ({method})."
        return LeanSimulationResult(
            state_vector=[], probabilities=probabilities, measurements=counts, bloch_coords=[],
            execution_time_ms=round((time.time() - started) * 1000, 1), shot_count=shots, seed_honored=honored,
            truncated=_truncation(plan, cut, reason), measurements_source="sampled", probabilities_exact=False,
        )
    little = plan.framework == "qiskit"
    vector = _qiskit_exact(circuit, seed) if plan.framework == "qiskit" else _cirq_exact(circuit)
    probabilities, bloch, cut = _exact_payload(vector, n, little)
    reason = f"{n} qubits: the state vector is not returned above {FULL_RESULT_MAX_QUBITS} qubits; exact probabilities are listed."
    return LeanSimulationResult(
        state_vector=[], probabilities=probabilities, measurements={}, bloch_coords=bloch,
        execution_time_ms=round((time.time() - started) * 1000, 1), shot_count=shots, seed_honored=honored,
        truncated=_truncation(plan, cut, reason), measurements_source="none", probabilities_exact=True,
    )


def shape_adapter_result(result: SimulationResult, plan: SimulationPlan) -> LeanSimulationResult:
    """An adapter's own result for a circuit above ``FULL_RESULT_MAX_QUBITS``, held to the same wire policy.

    The adapter ran (CUDA-Q, a third-party framework), so there is no estimate to enforce, but the frame
    obeys the same rules as the lean path: no state vector, at most ``MAX_PROBABILITIES`` outcome
    probabilities, and every withheld piece announced in ``truncated``.
    """
    import dataclasses

    probabilities, cut = top_probabilities(dict(result.probabilities))
    base = {f.name: getattr(result, f.name) for f in dataclasses.fields(SimulationResult)}
    # Fields this wrapper owns (an R-A SimulationResult may already carry some): keep the adapter's word.
    source = base.pop("measurements_source", None) or ("sampled" if result.measurements else "none")
    exact = bool(base.pop("probabilities_exact", False))
    for owned in ("truncated", "extras"):
        base.pop(owned, None)
    base.update(state_vector=[], probabilities=probabilities)
    reason = (
        f"{plan.qubits} qubits: the state vector is not returned above {FULL_RESULT_MAX_QUBITS} qubits"
        + ("; outcome probabilities were limited to the most probable " + str(MAX_PROBABILITIES) if cut else "")
        + "."
    )
    return LeanSimulationResult(
        **base, truncated={"state_vector": True, "probabilities": cut, "reason": reason},
        measurements_source=source, probabilities_exact=exact,
    )
