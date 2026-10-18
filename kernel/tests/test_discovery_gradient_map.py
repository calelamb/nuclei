"""gradient_map (addendum C): per-source-line gradient variances."""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("qiskit")

from kernel.discovery import gradient_map as gm  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402
from kernel.trainability.compiler import compile_circuit  # noqa: E402
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef  # noqa: E402
from kernel.trainability.pauli import parse_observable  # noqa: E402

# Line 8 (`# DEAD`) is an RZ applied to |0> before anything else: its gradient is exactly 0
# for every observable. Every other parameter is live.
PROGRAM = """\
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector


def build(n):
    qc = QuantumCircuit(n)
    t = ParameterVector("t", 4)
    qc.rz(t[0], 0)  # DEAD
    qc.ry(t[1], 0)
    qc.ry(t[2], 1)
    qc.cx(0, 1)
    qc.rx(t[3], 1)
    return qc
"""


def sandbox_circuit(program: str, n: int = 2) -> ParamCircuit:
    request = default_request("quantum_circuit", program, "build", [{"args": [n], "kwargs": {}}])
    response = run_candidate(request, wall_seconds=60)
    assert response["status"] == "ok", response
    return ParamCircuit.from_json(response["artifacts"][0]["artifact"]["ir"])


def line_of(text: str, marker: str) -> int:
    return next(i for i, row in enumerate(text.splitlines(), start=1) if marker in row)


def test_dead_parameter_flags_exactly_its_line_through_the_sandbox():
    circuit = sandbox_circuit(PROGRAM)
    result = gm.gradient_map(circuit, parse_observable("Z0*Z1 + X0 + X1", 2), samples=64, seed=5)
    dead_lines = [entry["line"] for entry in result["lines"] if entry["dead"]]
    assert dead_lines == [line_of(PROGRAM, "# DEAD")] == [8]
    assert [e["line"] for e in result["lines"]] == [8, 9, 10, 12]
    assert result["dead_fraction"] == pytest.approx(0.25)
    assert result["method"] == "statevector_sampling"
    assert result["n_qubits"] == 2
    dead = next(e for e in result["lines"] if e["dead"])
    assert dead["parameters"] == ["t[0]"] and dead["variance"] < 1e-8
    assert all(e["variance"] > 1e-3 for e in result["lines"] if not e["dead"])


def test_lines_without_a_recovered_source_line_are_omitted_not_guessed():
    gates = [
        IrGate("RY", (0,), (ParamRef("a"),), 0, 7),
        IrGate("RY", (0,), (ParamRef("b"),), 1, None),
        IrGate("CX", (0, 1), (), 2, 9),
    ]
    circuit = ParamCircuit(2, gates, ["a", "b"])
    result = gm.gradient_map(circuit, parse_observable("Z0", 2), samples=16, seed=0)
    assert [e["line"] for e in result["lines"]] == [7]


def test_circuit_without_any_lines_has_empty_map():
    circuit = ParamCircuit(1, [IrGate("RY", (0,), (ParamRef("a"),), 0, None)], ["a"])
    result = gm.gradient_map(circuit, parse_observable("Z0", 1), samples=8, seed=0)
    assert result["lines"] == [] and result["dead_fraction"] == 0.0


def test_loop_line_aggregates_its_parameters_and_is_dead_only_if_all_are():
    gates = [
        IrGate("RZ", (0,), (ParamRef("a"),), 0, 3),   # dead on |0>
        IrGate("RZ", (1,), (ParamRef("b"),), 1, 3),   # dead on |0>
        IrGate("RY", (0,), (ParamRef("c"),), 2, 4),
        IrGate("RZ", (1,), (ParamRef("d"),), 3, 5),   # dead on |0>
        IrGate("RY", (1,), (ParamRef("e"),), 4, 5),   # live
    ]
    circuit = ParamCircuit(2, gates, list("abcde"))
    result = gm.gradient_map(circuit, parse_observable("Z0 + Z1 + X0 + X1", 2), samples=64, seed=1)
    by_line = {e["line"]: e for e in result["lines"]}
    assert by_line[3]["parameters"] == ["a", "b"] and by_line[3]["dead"] is True
    assert by_line[4]["dead"] is False
    assert by_line[5]["parameters"] == ["d", "e"] and by_line[5]["dead"] is False


def test_fallback_variance_matches_a_manual_computation_with_the_shared_draw_order():
    circuit = sandbox_circuit(PROGRAM)
    observable = parse_observable("Z0*Z1 + X0", 2)
    stats = gm.gradient_variances(circuit, observable, samples=40, seed=9, prefer_analyses=False)
    thetas = np.random.default_rng(9).uniform(0, 2 * np.pi, (40, 4))
    _, grads = compile_circuit(circuit).value_and_grad(thetas, observable)
    assert np.allclose(stats["variances"], np.var(grads, axis=0, ddof=1))
    assert stats["source"] == "direct"
    assert stats["variance_mean"] == pytest.approx(float(np.mean(stats["variances"])))


def test_small_init_uses_the_normal_draw():
    thetas = gm.sample_thetas(3, 5, 2, "small")
    assert np.allclose(thetas, np.random.default_rng(3).normal(0, 0.1, (5, 2)))
    assert gm.sample_thetas(3, 5, 2).max() < 2 * np.pi


def test_map_is_deterministic_per_seed():
    circuit = sandbox_circuit(PROGRAM)
    observable = parse_observable("Z0*Z1", 2)
    first = gm.gradient_map(circuit, observable, samples=32, seed=4)
    assert first == gm.gradient_map(circuit, observable, samples=32, seed=4)
    assert first != gm.gradient_map(circuit, observable, samples=32, seed=5)


def test_analyses_gradient_statistics_is_preferred_when_importable():
    pytest.importorskip("kernel.trainability.analyses")
    circuit = sandbox_circuit(PROGRAM)
    observable = parse_observable("Z0*Z1 + X0", 2)
    via_analyses = gm.gradient_variances(circuit, observable, samples=64, seed=2)
    direct = gm.gradient_variances(circuit, observable, samples=64, seed=2, prefer_analyses=False)
    assert via_analyses["source"] == "analyses"
    assert np.allclose(via_analyses["variances"], direct["variances"], rtol=1e-9, atol=1e-12)
