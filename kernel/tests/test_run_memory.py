"""R-11: the memory-estimate policy (no allocation, host-independent unless noted)."""

from __future__ import annotations

import pytest

from kernel import run_memory
from kernel.models import CircuitSnapshot, Gate


def snapshot(n: int, measured: bool) -> CircuitSnapshot:
    gates = [Gate("H", [0])] + ([Gate("Measure", [0])] if measured else [])
    return CircuitSnapshot("qiskit", n, n if measured else 0, 1, gates)


def test_estimate_formula(monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 64 * (1 << 30))
    sampled = run_memory.plan_simulation(snapshot(30, True), "qiskit")
    exact = run_memory.plan_simulation(snapshot(30, False), "qiskit")
    assert sampled.mode == exact.mode == "lean"
    assert sampled.estimate_bytes == 2 * 2**30 * 16
    assert exact.estimate_bytes == run_memory.COPIES_EXACT * 2**30 * 16 == 4 * 2**30 * 16
    assert sampled.budget_bytes == 16 * (1 << 30) and sampled.budget_source == "ram_25pct"
    assert sampled.refused and exact.refused


def test_small_circuits_use_the_full_path_and_are_never_refused(monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 1 << 20)
    plan = run_memory.plan_simulation(snapshot(16, True), "qiskit")
    assert plan.mode == "full" and not plan.refused


def test_setting_lowers_the_budget_but_never_raises_it(monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 64 * (1 << 30))
    low = run_memory.plan_simulation(snapshot(20, True), "qiskit", memory_limit_mb=16)
    assert low.budget_source == "setting" and low.budget_bytes == 16 * (1 << 20) and low.refused
    high = run_memory.plan_simulation(snapshot(20, True), "qiskit", memory_limit_mb=10**9)
    assert high.budget_source == "ram_25pct" and not high.refused


def test_env_setting(monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 64 * (1 << 30))
    monkeypatch.setenv(run_memory.SIM_MEMORY_ENV, "2048")
    plan = run_memory.plan_simulation(snapshot(30, True), "qiskit")
    assert plan.budget_bytes == 2048 * (1 << 20) and plan.budget_source == "setting"


def test_mps_and_native_frameworks_have_no_estimate(monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 1 << 30)
    mps = run_memory.plan_simulation(snapshot(40, True), "qiskit", method="matrix_product_state")
    assert mps.mode == "mps" and not mps.refused
    assert run_memory.plan_simulation(snapshot(40, True), "stim").mode == "native"
    # MPS is offered for measured Qiskit circuits only.
    assert run_memory.plan_simulation(snapshot(40, False), "qiskit", method="matrix_product_state").mode == "lean"


def test_refusal_error_carries_estimate_and_actions(monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 64 * (1 << 30))
    error = run_memory.refusal_error(run_memory.plan_simulation(snapshot(30, True), "qiskit"))
    wire = error.to_dict()
    assert wire["code"] == "too_many_qubits"
    assert "34.4 GB" in wire["message"] and "30 qubits" in wire["message"]
    assert wire["estimate"]["bytes"] == 2 * 2**30 * 16
    assert [a["id"] for a in wire["actions"]] == ["rerun_mps", "open_lab"]
    unmeasured = run_memory.refusal_error(run_memory.plan_simulation(snapshot(30, False), "qiskit"))
    assert [a["id"] for a in unmeasured.to_dict()["actions"]] == ["open_lab"]


def test_top_probabilities_orders_by_probability_then_bitstring() -> None:
    probs = {format(i, "020b"): 1.0 / (i + 1) for i in range(run_memory.MAX_PROBABILITIES + 10)}
    kept, cut = run_memory.top_probabilities(probs)
    assert cut and len(kept) == run_memory.MAX_PROBABILITIES
    assert next(iter(kept)) == format(0, "020b")
    small, cut = run_memory.top_probabilities({"0": 0.5, "1": 0.5})
    assert not cut and small == {"0": 0.5, "1": 0.5}


def test_physical_ram_is_positive() -> None:
    assert run_memory.physical_ram_bytes() > 0


def test_lean_sampled_qiskit_run_reports_what_it_withheld() -> None:
    qiskit = pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    n = 18
    qc = qiskit.QuantumCircuit(n, n)
    qc.h(0)
    for q in range(1, n):
        qc.cx(0, q)
    qc.measure(range(n), range(n))
    plan = run_memory.plan_simulation(snapshot(n, True), "qiskit")
    result = run_memory.simulate_lean(qc, plan, 256, 7).to_dict()
    assert result["state_vector"] == [] and result["bloch_coords"] == []
    assert sum(result["measurements"].values()) == 256
    assert result["measurements_source"] == "sampled" and result["probabilities_exact"] is False
    assert result["truncated"]["state_vector"] is True and "18 qubits" in result["truncated"]["reason"]
    assert result["seed_honored"] is True


def test_lean_exact_qiskit_run_without_measurements() -> None:
    qiskit = pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")
    n = 17
    qc = qiskit.QuantumCircuit(n)
    qc.h(0)
    for q in range(1, n):
        qc.cx(0, q)
    plan = run_memory.plan_simulation(snapshot(n, False), "qiskit")
    result = run_memory.simulate_lean(qc, plan, 128, None).to_dict()
    assert result["measurements"] == {} and result["measurements_source"] == "none"
    assert result["probabilities_exact"] is True and result["state_vector"] == []
    assert sorted(result["probabilities"]) == ["0" * n, "1" * n]
    assert len(result["bloch_coords"]) == n


# -- top-K selection happens in numpy (R-11: no 2^n Python objects behind the guard) ------------------------


def test_top_indices_matches_a_brute_force_ranking_including_ties() -> None:
    np = pytest.importorskip("numpy")
    rng = np.random.default_rng(3)
    probs = rng.integers(0, 6, size=500).astype(float) / 100.0  # many equal values -> many ties
    probs[rng.integers(0, 500, size=40)] = 0.0
    for limit in (1, 7, 50, 499, 500, 5000):
        keep, cut = run_memory.top_indices(probs, limit)
        live = [(-float(probs[i]), int(i)) for i in range(500) if probs[i] > run_memory.PROBABILITY_FLOOR]
        expected = [i for _p, i in sorted(live)[:limit]]
        assert [int(i) for i in keep] == expected
        assert cut is (len(live) > limit)


def test_exact_payload_formats_only_the_survivors(monkeypatch) -> None:
    np = pytest.importorskip("numpy")
    monkeypatch.setattr(run_memory, "MAX_PROBABILITIES", 4)
    vector = np.sqrt(np.array([0.4, 0.3, 0.1, 0.1, 0.05, 0.05, 0.0, 0.0]))
    mapping, _bloch, cut = run_memory._exact_payload(vector.astype(complex), 3, True)
    assert cut is True and list(mapping) == ["000", "001", "010", "011"]


def test_peak_memory_of_a_dense_exact_run_stays_near_the_estimate() -> None:
    """H on every one of 22 qubits has 4 M nonzero probabilities: the old dict+sort peaked at ~7x the estimate."""
    import subprocess
    import sys
    import textwrap

    pytest.importorskip("qiskit_aer")
    script = textwrap.dedent(
        """
        import resource, sys, json
        from qiskit import QuantumCircuit
        from kernel import run_memory
        from kernel.models import CircuitSnapshot, Gate

        def run(n):
            qc = QuantumCircuit(n)
            qc.h(range(n))
            plan = run_memory.plan_simulation(CircuitSnapshot("qiskit", n, 0, 1, [Gate("H", [0])]), "qiskit")
            return plan, run_memory.simulate_lean(qc, plan, 16, 1)

        scale = 1 if sys.platform == "darwin" else 1024
        run(17)  # imports, thread pools and allocator warm-up
        base = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale
        plan, result = run(22)
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale
        print(json.dumps({"estimate": plan.estimate_bytes, "growth": peak - base, "kept": len(result.probabilities)}))
        """
    )
    import os

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = subprocess.run([sys.executable, "-c", script], cwd=root, capture_output=True, text=True, timeout=240, check=True)
    import json

    report = json.loads(out.stdout.strip().splitlines()[-1])
    margin = 64 * (1 << 20)
    assert report["kept"] == run_memory.MAX_PROBABILITIES
    assert report["growth"] <= report["estimate"] + margin, report


# -- the lean path keeps the adapter pipeline's guarantees (R-2 above 16 qubits) -----------------------------


def efficientsu2_measured(n: int):
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import EfficientSU2

    ansatz = EfficientSU2(n, reps=1)
    bound = ansatz.assign_parameters([0.1 * (i + 1) for i in range(ansatz.num_parameters)])
    qc = QuantumCircuit(n, n)
    qc.append(bound, range(n))
    qc.measure(range(n), range(n))
    return qc


def test_lean_sampled_run_expands_library_ansatz_blocks() -> None:
    pytest.importorskip("qiskit_aer")
    n = 18
    qc = efficientsu2_measured(n)
    plan = run_memory.plan_simulation(snapshot(n, True), "qiskit")
    result = run_memory.simulate_lean(qc, plan, 64, 5)
    assert plan.mode == "lean" and sum(result.measurements.values()) == 64


def test_lean_exact_run_expands_library_ansatz_blocks() -> None:
    pytest.importorskip("qiskit_aer")
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import QFT

    n = 17
    qc = QuantumCircuit(n)
    qc.h(range(n))
    qc.append(QFT(n), range(n))
    plan = run_memory.plan_simulation(snapshot(n, False), "qiskit")
    result = run_memory.simulate_lean(qc, plan, 1, 5)
    assert result.probabilities_exact is True and abs(sum(result.probabilities.values()) - 1.0) < 1e-6


# -- frameworks the lean path cannot drive run through their own adapter (CUDA-Q, third parties) -------------


def test_non_lean_frameworks_above_the_cap_are_planned_for_their_adapter(monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 1 << 20)  # a refusal would be certain
    for framework in ("cuda-q", "my-adapter"):
        plan = run_memory.plan_simulation(
            CircuitSnapshot(framework, 30, 30, 1, [Gate("H", [0]), Gate("Measure", [0])]), framework
        )
        assert plan.mode == "adapter" and not plan.refused and plan.estimate_bytes == 0


def test_executor_runs_a_big_non_lean_adapter_and_shapes_its_result() -> None:
    from kernel.executor import Executor
    from kernel.models import SimulationResult

    n = 20
    calls: list = []

    class BigAdapter:
        def simulate(self, circuit, shots, seed=None):
            calls.append((shots, seed))
            return SimulationResult(
                state_vector=[{"re": 1.0, "im": 0.0}] * 8, probabilities={"0" * n: 0.5, "1" * n: 0.5},
                measurements={"0" * n: 3, "1" * n: 5}, bloch_coords=[], execution_time_ms=1.0, shot_count=8,
            )

    class Spec:
        framework = "cuda-q"

    snap = CircuitSnapshot("cuda-q", n, n, 1, [Gate("H", [0]), Gate("Measure", [0])])
    result, error = Executor()._simulate(Spec(), BigAdapter(), object(), snap, 8, 3, None, None)
    assert error is None and calls == [(8, 3)]
    wire = result.to_dict()
    assert wire["state_vector"] == [] and wire["truncated"]["state_vector"] is True
    assert wire["measurements_source"] == "sampled" and wire["probabilities_exact"] is False
    assert wire["measurements"] == {"0" * n: 3, "1" * n: 5}


def test_big_non_lean_adapter_probabilities_are_capped(monkeypatch) -> None:
    from kernel.models import SimulationResult

    monkeypatch.setattr(run_memory, "MAX_PROBABILITIES", 3)
    plan = run_memory.plan_simulation(CircuitSnapshot("cuda-q", 20, 0, 1, [Gate("H", [0])]), "cuda-q")
    probabilities = {format(i, "05b"): p for i, p in enumerate([0.4, 0.3, 0.2, 0.05, 0.05])}
    shaped = run_memory.shape_adapter_result(
        SimulationResult([], probabilities, {}, [], 1.0, 8), plan
    )
    assert list(shaped.probabilities) == ["00000", "00001", "00010"]
    assert shaped.truncated["probabilities"] is True
