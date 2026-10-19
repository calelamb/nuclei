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
    assert exact.estimate_bytes == 3 * 2**30 * 16
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
