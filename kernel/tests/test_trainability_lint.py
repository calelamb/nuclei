"""Lint rules TRN001-TRN007: a positive and a negative test each, plus budget, lines and soundness."""

from __future__ import annotations

import math
import time

import numpy as np
import pytest

from kernel.tests._trainability_helpers import random_circuit, random_observable
from kernel.tests._trainability_physics_helpers import Builder, hea_circuit, random_ppe_circuit, two_axis_hea
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.lint import RULES, lint
from kernel.trainability.pauli import parse_observable


def codes(res: dict) -> list[str]:
    return [d["code"] for d in res["diagnostics"]]


def _free_fermion(n: int, layers: int = 1) -> ParamCircuit:
    b = Builder(n)
    for _ in range(layers):
        for q in range(n):
            b.rot("RX", (q,))
        for q in range(n - 1):
            b.rot("RZZ", (q, q + 1))
    return b.build()


# --------------------------------------------------------------------- TRN001
def test_trn001_fires_for_global_observable_with_spec_diagnostic_shape():
    res = lint(two_axis_hea(4, 1), parse_observable("preset:global_z", 4))
    d = next(d for d in res["diagnostics"] if d["code"] == "TRN001")
    assert d["severity"] == "warning" and d["title"] == "Global cost function"
    assert d["citation"] == {"label": "Cerezo et al., Nat. Commun. 12, 1791 (2021)",
                             "url": "https://doi.org/10.1038/s41467-021-21728-w"}
    assert "4" in d["message"] and set(d) == {"code", "severity", "title", "message", "citation", "line",
                                              "source_indices"}


@pytest.mark.parametrize("n,spec", [(4, "preset:local_z"), (3, "Z0*Z1*Z2"), (6, "Z0*Z1*Z2"), (8, "Z0*Z1*Z2*Z3")])
def test_trn001_silent_for_local_small_or_below_threshold(n, spec):
    assert "TRN001" not in codes(lint(two_axis_hea(n, 1), parse_observable(spec, n)))


def test_trn001_threshold_is_max_3_ceil_half_n_plus_1():
    assert "TRN001" in codes(lint(two_axis_hea(6, 1), parse_observable("Z0*Z1*Z2*Z3", 6)))     # 4 >= max(3, 4)
    assert "TRN001" in codes(lint(two_axis_hea(8, 1), parse_observable("Z0*Z1*Z2*Z3*Z4", 8)))  # 5 >= max(3, 5)


# --------------------------------------------------------------------- TRN002
def test_trn002_fires_for_full_algebra_at_n4_and_cites_ragone():
    res = lint(two_axis_hea(4, 3), parse_observable("preset:local_z", 4))
    d = next(d for d in res["diagnostics"] if d["code"] == "TRN002")
    assert d["severity"] == "warning" and "255" in d["message"] and "doi.org/10.1038/s41467-024-49909-3" in d["citation"]["url"]
    assert res["summary"]["dla"] == {"status": "complete", "dimension": 255}


def test_trn002_silent_below_n4_and_for_polynomial_algebras():
    assert "TRN002" not in codes(lint(two_axis_hea(3, 3), parse_observable("Z0", 3)))      # su(8) but n < 4
    assert "TRN002" not in codes(lint(_free_fermion(4), parse_observable("Z0*Z1", 4)))     # n(2n-1): free fermion


# --------------------------------------------------------------------- TRN003
def test_trn003_fires_for_polynomial_dla_and_stays_silent_for_large_dla():
    res = lint(_free_fermion(4), parse_observable("Z0*Z1", 4))
    d = next(d for d in res["diagnostics"] if d["code"] == "TRN003")
    assert d["severity"] == "info" and "28" in d["message"] and "Goh" in d["citation"]["label"]
    assert "TRN003" not in codes(lint(two_axis_hea(4, 3), parse_observable("Z0", 4)))
    # wording: a polynomial dimension suggests simulability but does not guarantee trainability (PH-M3)
    assert "trainable in the barren-plateau sense" not in d["message"]
    assert "does not by itself guarantee trainability" in d["message"]


def test_trn003_is_silent_for_a_full_exponential_family_at_small_n():
    from kernel.tests._trainability_physics_helpers import brickwork_hea
    res = lint(brickwork_hea(3, 4), parse_observable("Z0", 3))     # so(8) = so(2^3): dim 28 <= 4n^2 = 36
    assert "TRN003" not in codes(res)


# --------------------------------------------------------------------- TRN004
def test_trn004_flags_a_dead_parameter_with_its_gate_and_line():
    b = Builder(3)
    b.rot("RZ", (2,)).rot("RX", (0,)).rot("RY", (1,)).add("CZ", (0, 1))
    c = b.build()
    c = ParamCircuit(3, [IrGate(g.name, g.qubits, g.angles, g.source_index, 10 + i) for i, g in enumerate(c.gates)],
                     c.parameters)
    res = lint(c, parse_observable("Z0", 3))
    dead = [d for d in res["diagnostics"] if d["code"] == "TRN004"]
    assert [d["source_indices"] for d in dead] == [[0], [2]]      # RZ on an untouched qubit; RY(1) before CZ(0,1)
    assert [d["line"] for d in dead] == [10, 12] and dead[0]["severity"] == "info"
    assert "t0" in dead[0]["message"] and res["summary"]["trn004"] == "complete"


def test_trn004_silent_when_every_parameter_matters():
    b = Builder(2)
    b.rot("RX", (0,)).add("CX", (0, 1)).rot("RY", (1,))
    assert "TRN004" not in codes(lint(b.build(), parse_observable("Z1", 2)))


def test_trn004_shared_parameter_is_dead_only_if_every_gate_is():
    gates = [IrGate("RZ", (1,), (ParamRef("a"),), 0), IrGate("RX", (0,), (ParamRef("b"),), 1),
             IrGate("RZ", (1,), (ParamRef("c"),), 2), IrGate("RX", (1,), (ParamRef("c"),), 3)]
    only_dead_gate = ParamCircuit(2, gates[:3], ["a", "b", "c"])
    both = ParamCircuit(2, gates, ["a", "b", "c"])
    obs = parse_observable("Z0", 2)
    assert [d["source_indices"] for d in lint(only_dead_gate, obs)["diagnostics"] if d["code"] == "TRN004"] == [[0], [2]]
    flagged = [d["source_indices"] for d in lint(both, obs)["diagnostics"] if d["code"] == "TRN004"]
    assert flagged == [[0], [2], [3]]    # c drives two gates on qubit 1, both commute with Z0: dead on both
    # a shared parameter with one live gate must not be flagged at all
    mixed = ParamCircuit(2, [IrGate("RX", (0,), (ParamRef("c"),), 0), IrGate("RX", (1,), (ParamRef("c"),), 1)], ["c"])
    assert "TRN004" not in codes(lint(mixed, obs))


def test_trn004_uses_exact_ppe_annihilation_where_the_symbolic_test_cannot():
    """RZ acting first on |0> is dead, but its generator anticommutes with the evolved observable's Y part."""
    b = Builder(1)
    b.rot("RZ", (0,)).rot("RX", (0,))
    d = [x for x in lint(b.build(), parse_observable("Z0", 1))["diagnostics"] if x["code"] == "TRN004"]
    assert [x["source_indices"] for x in d] == [[0]]
    # with a non-Clifford fixed gate the PPE does not apply and the (sound, incomplete) symbolic test stays silent
    c = Builder(1)
    c.rot("RZ", (0,)).rot("RX", (0,)).add("T", (0,))
    assert "TRN004" not in codes(lint(c.build(), parse_observable("Z0", 1)))


def test_trn004_flags_are_sound_gradients_vanish_identically():
    """Property test: every flagged parameter has an identically zero gradient (random IR incl. shared/affine/T)."""
    rng = np.random.default_rng(8)
    flagged_total = 0
    for trial in range(40):
        n = int(rng.integers(2, 5))
        c = random_circuit(rng, n, int(rng.integers(4, 14)), int(rng.integers(1, 5))) if trial % 2 else \
            random_ppe_circuit(rng, n, int(rng.integers(4, 18)), with_u=False)
        if not c.parameters:
            continue
        obs = random_observable(rng, n, 2)
        res = lint(c, obs, time_budget_s=5.0)
        index = c.param_index()
        flagged = {index[m] for d in res["diagnostics"] if d["code"] == "TRN004"
                   for m in _param_of(c, d["source_indices"])}
        if not flagged:
            continue
        v = rng.uniform(0, 2 * math.pi, (5, len(c.parameters)))
        _, g = compile_circuit(c).value_and_grad(v, obs)
        for k in flagged:
            assert np.abs(g[:, k]).max() < 1e-9, (trial, k)
        flagged_total += len(flagged)
    assert flagged_total > 0


def _param_of(circuit, source_indices):
    return {a.name for i in source_indices for g in circuit.gates if g.source_index == i
            for a in g.angles if isinstance(a, ParamRef)}


# --------------------------------------------------------------------- TRN005
def _two_rotations(first, second, qubits=((0,), (0,)), between=None, names=("a", "b")):
    gates = [IrGate(first, qubits[0], (ParamRef(names[0]),), 0)]
    if between:
        gates.append(between)
    gates.append(IrGate(second, qubits[1], (ParamRef(names[1]),), 5))
    return ParamCircuit(2, gates, sorted(set(names)))


def test_trn005_fires_for_consecutive_same_axis_independent_parameters():
    res = lint(_two_rotations("RX", "RX"), parse_observable("Z1", 2))
    d = next(d for d in res["diagnostics"] if d["code"] == "TRN005")
    assert d["source_indices"] == [0, 5] and d["severity"] == "info" and "redundant" in d["message"]
    assert "TRN005" in codes(lint(_two_rotations("RZ", "P"), parse_observable("Z1", 2)))     # P is a Z rotation


@pytest.mark.parametrize("make", [
    lambda: _two_rotations("RX", "RY"),                                                   # different axis
    lambda: _two_rotations("RX", "RX", names=("a", "a")),                                 # same parameter (merged)
    lambda: _two_rotations("RX", "RX", qubits=((0,), (1,))),                              # different qubits
    lambda: _two_rotations("RX", "RX", between=IrGate("CZ", (0, 1), (), 3)),              # a gate in between
])
def test_trn005_silent_otherwise(make):
    assert "TRN005" not in codes(lint(make(), parse_observable("Z1", 2)))


# --------------------------------------------------------------------- TRN006
def test_trn006_fires_when_parameters_reach_the_dimension():
    b = Builder(1)
    b.rot("RZ", (0,))
    res = lint(b.build(), parse_observable("Z0", 1))
    d = next(d for d in res["diagnostics"] if d["code"] == "TRN006")
    assert d["severity"] == "info" and "Larocca" in d["citation"]["label"] and "1 parameters" in d["message"]
    assert "TRN006" in codes(lint(_free_fermion(4, 5), parse_observable("Z0*Z1", 4)))     # 35 params >= dim 28


def test_trn006_silent_when_the_algebra_is_larger_than_the_parameter_count():
    assert "TRN006" not in codes(lint(two_axis_hea(3, 1), parse_observable("Z0", 3)))   # 6 params, dim 9
    assert "TRN006" not in codes(lint(_free_fermion(4, 1), parse_observable("Z0*Z1", 4)))   # 7 params, dim 28


# --------------------------------------------------------------------- TRN007
def test_trn007_only_without_free_parameters_and_has_no_line():
    c = ParamCircuit(2, [IrGate("H", (0,), (), 0, 4), IrGate("CX", (0, 1), (), 1, 5)], [])
    res = lint(c, parse_observable("Z0", 2))
    assert codes(res) == ["TRN007"] and res["diagnostics"][0]["line"] is None
    assert res["summary"]["n_parameters"] == 0 and res["summary"]["dla"] is None
    assert "TRN007" not in codes(lint(hea_circuit(2, 1), parse_observable("Z0", 2)))


def test_declared_but_unused_parameters_do_not_count():
    c = ParamCircuit(1, [IrGate("H", (0,))], ["unused"])
    assert codes(lint(c, parse_observable("Z0", 1))) == ["TRN007"]


# ------------------------------------------------- budget, lines, summary
def test_dla_budget_skips_dla_rules_and_says_so():
    res = lint(two_axis_hea(8, 4), parse_observable("preset:local_z", 8), time_budget_s=0.001)
    assert not {"TRN002", "TRN003", "TRN006"} & set(codes(res))
    s = res["summary"]
    assert s["skipped_rules"] == ["TRN002", "TRN003", "TRN006"] and "did not finish" in s["skipped_reason"]
    assert s["dla"]["status"] == "truncated" and s["trn004"] in ("partial", "complete")


def test_default_budget_is_respected_for_a_big_circuit():
    t0 = time.perf_counter()
    res = lint(two_axis_hea(9, 6), parse_observable("preset:tfim", 9))
    assert time.perf_counter() - t0 < 1.5     # 0.35 s budget plus bounded overheads (machine may be loaded)
    assert res["summary"]["elapsed_ms"] < 1500


def test_lines_come_from_source_lines_then_gate_source_line():
    b = Builder(3)
    b.rot("RZ", (2,)).rot("RX", (0,))
    base = b.build()
    obs = parse_observable("Z0", 3)
    assert lint(base, obs)["diagnostics"][0]["line"] is None
    with_lines = ParamCircuit(3, [IrGate(g.name, g.qubits, g.angles, g.source_index, 77) for g in base.gates],
                              base.parameters)
    assert next(d for d in lint(with_lines, obs)["diagnostics"] if d["code"] == "TRN004")["line"] == 77
    assert next(d for d in lint(with_lines, obs, source_lines={0: 5})["diagnostics"] if d["code"] == "TRN004")["line"] == 5


def test_summary_shape_and_canonical_observable_text():
    res = lint(_free_fermion(3), parse_observable("Z0 + Z1", 3))
    s = res["summary"]
    assert {"n_qubits", "n_parameters", "dla", "observable", "elapsed_ms"} <= set(s)
    assert s["n_qubits"] == 3 and s["n_parameters"] == 5 and s["observable"] == "Z0 + Z1"
    assert s["dla"] == {"status": "complete", "dimension": 15}


def test_no_observable_skips_observable_rules_but_keeps_the_rest():
    res = lint(_free_fermion(4), None)
    assert "TRN001" not in codes(res) and "TRN004" not in codes(res) and "TRN003" in codes(res)
    assert res["summary"]["observable"] is None and res["summary"]["trn004"] == "skipped"


def test_rule_table_matches_spec_severities():
    assert {c: sev for c, (sev, _) in RULES.items()} == {
        "TRN001": "warning", "TRN002": "warning", "TRN003": "info", "TRN004": "info", "TRN005": "info",
        "TRN006": "info", "TRN007": "info"}


def test_lint_is_deterministic():
    c, o = two_axis_hea(4, 3), parse_observable("preset:global_z", 4)
    strip = lambda r: [{k: v for k, v in d.items()} for d in r["diagnostics"]]  # noqa: E731
    assert strip(lint(c, o)) == strip(lint(c, o))
