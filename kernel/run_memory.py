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

import dataclasses
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
    width_known: bool = True
    nondeterministic: bool = False  # unmeasured, but reset/channel/classical control: one sampled trajectory

    @property
    def refused(self) -> bool:
        return self.mode in ("lean", "adapter") and self.estimate_bytes > self.budget_bytes


def has_measurements(snapshot) -> bool:
    return any(gate.type == "Measure" for gate in snapshot.gates)


def circuit_facts(framework: str, circuit) -> tuple[int | None, bool | None]:
    """``(width, measured)`` read off the circuit itself; ``None`` where it cannot be known.

    Used when the snapshot (the diagram) failed: the memory policy must never plan from an empty
    stand-in, because "no gates" reads as "no measurements".
    """
    try:
        width: int | None = getattr(circuit, "num_qubits", None)
    except Exception:  # noqa: BLE001 - a property that raises (not just AttributeError) is an unknown width
        width = None
    if not isinstance(width, int):
        try:
            width = len(circuit.all_qubits())
        except Exception:  # noqa: BLE001 - unknown width is a planning input, handled conservatively
            width = None
    measured: bool | None = None
    try:
        if framework == "qiskit":
            from kernel.adapters._qiskit_aer import has_measurements as qiskit_measured

            measured = bool(qiskit_measured(circuit))
        elif framework == "cirq":
            import cirq

            measured = bool(cirq.is_measurement(circuit))
    except Exception:  # noqa: BLE001 - unknown measurement status is handled conservatively
        measured = None
    return width, measured


def is_nondeterministic(framework: str, circuit) -> bool:
    """True when an UNMEASURED circuit is still one random trajectory (reset, noise channel, classical control).

    An unknowable answer counts as non-deterministic: the honest default is "sampled", never "exact".
    """
    if circuit is None:
        return False
    try:
        if framework == "qiskit":
            from kernel.adapters._qiskit_aer import is_deterministic

            return not is_deterministic(circuit)
        if framework == "cirq":
            import cirq

            return not all(cirq.has_unitary(op) for op in circuit.all_operations())
    except Exception:  # noqa: BLE001 - cannot tell: do not claim exactness
        return True
    return False


def _snapshot_or_circuit_facts(snapshot, framework: str, circuit) -> tuple[int | None, bool | None]:
    """Width from the snapshot when there is one; measurements from the CIRCUIT whenever there is one.

    A snapshot lists only top-level gates, so a ``measure`` inside a control-flow block or a sub-instruction
    is invisible to it; the circuit is the only honest source for Qiskit and Cirq.
    """
    if circuit is not None and framework in LEAN_FRAMEWORKS:
        circuit_width, measured = circuit_facts(framework, circuit)
        return (snapshot.qubit_count if snapshot is not None else circuit_width), measured
    if snapshot is not None:
        return snapshot.qubit_count, has_measurements(snapshot)
    return circuit_facts(framework, circuit)


def plan_simulation(
    snapshot, framework: str, *, method: str | None = None, memory_limit_mb: int | None = None, circuit=None
) -> SimulationPlan:
    """Plan from the ``circuit`` (measurements) and the ``snapshot`` (width); with no snapshot, from the circuit alone.

    An unknown width plans ``adapter``: the adapter runs and its result is shaped (never a raw state
    vector).  A known width above the cap with measurements that cannot be determined also plans ``adapter``
    but keeps the lean 2^n estimate (exact-state copies) so the R-11 refusal check still applies.
    """
    width, measured = _snapshot_or_circuit_facts(snapshot, framework, circuit)
    if framework in NATIVE_FRAMEWORKS:
        return SimulationPlan(width or 0, framework, "native", bool(measured))
    if width is None:
        return SimulationPlan(0, framework, "adapter", bool(measured), width_known=False)
    if width <= FULL_RESULT_MAX_QUBITS:
        return SimulationPlan(width, framework, "full", bool(measured))
    if framework not in LEAN_FRAMEWORKS:
        # CUDA-Q (GPU targets, tensor networks) and third-party adapters own their simulation and their
        # memory model: a 2^n x 16 B estimate would be fiction.  The adapter runs; its result is shaped.
        return SimulationPlan(width, framework, "adapter", bool(measured))
    budget, source = simulation_budget(memory_limit_mb)
    if measured is None:
        copies = COPIES_EXACT
        return SimulationPlan(
            width, framework, "adapter", False, copies, copies * (2 ** width) * AMPLITUDE_BYTES, budget, source
        )
    if method == MPS_METHOD and framework == "qiskit" and measured:
        return SimulationPlan(width, framework, "mps", measured)
    nondeterministic = not measured and is_nondeterministic(framework, circuit)
    copies = COPIES_SAMPLED if measured or nondeterministic else COPIES_EXACT
    return SimulationPlan(
        width, framework, "lean", measured, copies, copies * (2 ** width) * AMPLITUDE_BYTES, budget, source,
        nondeterministic=nondeterministic,
    )


def resolve_unknown_width(plan: SimulationPlan, result: SimulationResult) -> SimulationPlan:
    """A plan made without a known width, completed from the adapter's own result (so it can be shaped)."""
    if plan.width_known:
        return plan
    sizes = [len(key) for key in result.probabilities] + [len(key) for key in result.measurements]
    amplitudes = len(result.state_vector)
    if amplitudes > 1:
        sizes.append(amplitudes.bit_length() - 1)
    return dataclasses.replace(plan, qubits=max(sizes, default=0), width_known=True)


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
    """``(prepare, run)`` for Aer: R-A's helpers, so the lean path (above 16 qubits) behaves exactly like the adapter path.

    Aer only accepts its own basis, so a circuit holding ``EfficientSU2``/``TwoLocal``/``QFT`` blocks
    must be rewritten into it first (audit R-2).
    """
    from kernel.adapters._qiskit_aer import prepare_for_aer, run_on_aer

    return prepare_for_aer, run_on_aer


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


def _measured_copy(framework: str, circuit):
    """A copy that measures every qubit at the end, so a non-deterministic unmeasured circuit can be sampled."""
    if framework == "qiskit":
        copy = circuit.copy()
        copy.measure_all()
        return copy
    import cirq

    qubits = sorted(circuit.all_qubits())
    return circuit + cirq.Circuit(cirq.measure(*qubits, key="m"))


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
    if plan.has_measurements or plan.nondeterministic:
        mps = plan.mode == "mps"
        if plan.nondeterministic and not plan.has_measurements:
            circuit = _measured_copy(plan.framework, circuit)
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
