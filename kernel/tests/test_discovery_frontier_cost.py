"""trainability_frontier: the exact-cost metric, light cone, and what it refuses to reward (PH-H3, PH-M4)."""

from __future__ import annotations

import math

import numpy as np
import pytest

pytest.importorskip("qiskit")
from qiskit import QuantumCircuit  # noqa: E402

from kernel.discovery.evaluators._frontier_cost import (  # noqa: E402
    clip_interval, exact_cost_point, pp_exact_cost, scored_hardness,
)
from kernel.discovery.evaluators._frontier_observable import frontier_observable  # noqa: E402
from kernel.discovery.evaluators._frontier_structure import light_cone_width, strip_trivial_prefix  # noqa: E402
from kernel.tests.test_discovery_frontier import SPEC, artifact, brick_ansatz, config, seed_like  # noqa: E402
from kernel.trainability.convert import from_object  # noqa: E402
from kernel.trainability.pauliprop import ppe_expectation_bounds  # noqa: E402


def circuit_of(builder, n, layers):
    return from_object(builder(n, layers))


def test_clip_interval_never_exceeds_the_l1_bound():
    assert clip_interval([-128.7, 126.0], 64.0) == ([-64.0, 64.0], True)
    assert clip_interval([-0.2, 0.3], 64.0) == ([-0.2, 0.3], False)


def test_exact_cost_equals_the_untruncated_frontier_peak():
    circuit = circuit_of(brick_ansatz, 12, 3)
    obs = frontier_observable("preset:local_z", 12)
    values = np.random.default_rng(3).uniform(0, 2 * math.pi, len(circuit.parameters))
    direct = ppe_expectation_bounds(circuit, obs, values, min_weight_abs=0, max_frontier=200000, time_budget_s=20)
    point = exact_cost_point(circuit, obs, values, max_frontier=200000, time_budget_s=20)
    assert point["exact"] and not point["censored"]
    assert point["frontier_peak"] == direct["frontier_peak"]
    assert point["log10_strings"] == pytest.approx(math.log10(direct["frontier_peak"]))
    assert point["value"] == pytest.approx(direct["value"])


def test_a_run_that_hits_the_frontier_cap_is_censored_with_the_peak_as_a_lower_bound():
    circuit = circuit_of(brick_ansatz, 12, 6)
    obs = frontier_observable("preset:local_z", 12)
    values = np.random.default_rng(3).uniform(0, 2 * math.pi, len(circuit.parameters))
    point = exact_cost_point(circuit, obs, values, max_frontier=500, time_budget_s=20)
    assert point["censored"] and not point["exact"]
    assert point["frontier_peak"] <= 500 and point["log10_strings"] == pytest.approx(math.log10(point["frontier_peak"]))
    assert -12.0 <= point["interval"][0] and point["interval"][1] <= 12.0  # clipped to +-l1


def test_the_probe_is_pessimistic_and_censored_iff_its_minimum_is():
    circuit = circuit_of(brick_ansatz, 10, 3)
    obs = frontier_observable("preset:local_z", 10)
    cost = pp_exact_cost(circuit, obs, seed=1, stage="full", max_frontier=100000, time_budget_s=20, target_width=0.02)
    assert len(cost["points"]) == 3
    assert cost["log10_strings_lower"] == min(p["log10_strings"] for p in cost["points"])
    assert cost["censored"] == min(cost["points"], key=lambda p: p["log10_strings"])["censored"]
    assert cost["diagnostics"]["bound_width_curve"]["role"] == "diagnostic_only"


def test_scored_hardness_is_capped_by_the_light_cone_brute_force_cost():
    cost = {"log10_strings_lower": 5.0}
    capped = scored_hardness(cost, 8)
    assert capped["value"] == pytest.approx(8 * math.log10(2)) and capped["capped_by_light_cone"]
    open_ = scored_hardness(cost, 40)
    assert open_["value"] == 5.0 and not open_["capped_by_light_cone"]


# --- the light cone ------------------------------------------------------------


def test_light_cone_of_a_cx_chain_covers_the_chain():
    qc = QuantumCircuit(4)
    qc.h(0)
    qc.cx(0, 1)
    qc.cx(1, 2)
    stripped = strip_trivial_prefix(from_object(qc))
    assert light_cone_width(stripped, frontier_observable("Z2", 4))["width"] == 3
    assert light_cone_width(stripped, frontier_observable("Z3", 4))["width"] == 1  # untouched qubit


def test_light_cone_grows_with_depth_and_is_bounded_by_n():
    widths = []
    for layers in (1, 2, 3, 4, 5):
        circuit = circuit_of(brick_ansatz, 40, layers)
        widths.append(light_cone_width(strip_trivial_prefix(circuit), frontier_observable("preset:local_z", 40))["width"])
    assert widths == sorted(widths) and widths[0] < widths[-1] <= 40
    assert widths[0] == 1  # one layer: only the Z-commuting CZs follow the last rotation


def test_a_diagonal_dressing_does_not_widen_the_light_cone():
    plain = circuit_of(lambda n, L: brick_ansatz(n, L, entangle=False), 16, 2)
    qc = QuantumCircuit(16)
    for q in range(15):
        qc.cz(q, q + 1)
    dressed = from_object(qc.compose(brick_ansatz(16, 2, entangle=False)))
    obs = frontier_observable("preset:local_z", 16)
    assert light_cone_width(strip_trivial_prefix(plain), obs)["width"] == 1
    assert light_cone_width(strip_trivial_prefix(dressed), obs)["width"] == 1


# --- end to end ----------------------------------------------------------------


def run(builder, overrides=None, seed=1):
    cfg = config(overrides)
    arts = [{"call_index": i, "artifact": artifact(builder(*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))]
    return SPEC.score(cfg, arts, seed, None, None, stage="full").to_dict()


def test_a_shallow_candidate_is_capped_by_its_light_cone_even_when_pp_is_costly():
    """Depth 2 on 10 qubits: the light cone is far below 12, so the scored hardness is the cone cost."""
    result = run(seed_like, {"n_layers": 2})
    m = result["metrics"]
    assert result["status"] == "scored" and m["light_cone"]["brute_force_simulable"] is True
    assert m["hardness"]["capped_by_light_cone"] is True
    assert m["hardness"]["value"] < m["pp_exact_cost"]["log10_strings_lower"]
    assert result["objectives"]["pp_exact_cost"]["value"] == m["pp_exact_cost"]["log10_strings_lower"]


def test_the_bound_looseness_no_longer_masquerades_as_hardness():
    """PH-H3: a candidate PP computes exactly with few strings is not 'hard' because its bound is loose."""
    result = run(seed_like, {"qubits": [4, 6, 8, 10], "n_layers": 3, "estimation": {"target_width": 1e-6}})
    cost = result["metrics"]["pp_exact_cost"]
    assert cost["censored"] is False and cost["strings_lower"] < 20000
    # the old metric would have reported the censored maximum for a 1e-6 target width on a loose bound
    assert result["objectives"]["pp_exact_cost"]["value"] < 4.5


def test_dla_fill_fraction_separates_polynomial_from_full_algebras():
    """PH-M4: n = 4 saturates su(16) for nearly everything; the fraction at a larger probe does not."""
    from kernel.discovery.evaluators._frontier_metrics import dla_fill_fraction

    probe = lambda n, dim: {"probe_qubits": n, "dimension": dim, "dimension_lower_bound": dim}  # noqa: E731
    assert dla_fill_fraction(probe(6, 4 ** 6 - 1)) == pytest.approx(1.0)
    assert dla_fill_fraction(probe(6, 6 * 11)) == pytest.approx(math.log2(66) / math.log2(4095))  # so(12): ~0.50
    assert dla_fill_fraction(probe(6, 18)) < 0.4
    assert dla_fill_fraction({"probe_qubits": 6, "dimension": None, "dimension_lower_bound": 4096}) == 1.0
    assert run(seed_like)["descriptors"]["dla_fill_fraction"] == pytest.approx(1.0, abs=1e-3)
