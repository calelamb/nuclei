"""trainability_frontier evaluator: config, one rejecting candidate per guardrail, scoring, stages."""

from __future__ import annotations

import copy

import pytest

pytest.importorskip("qiskit")
from qiskit import QuantumCircuit  # noqa: E402
from qiskit.circuit import Parameter, ParameterVector  # noqa: E402
from qiskit.circuit.library import UnitaryGate  # noqa: E402

from kernel.discovery.evaluators import EVALUATORS, InvalidConfig, effective_config, normalize_config  # noqa: E402
from kernel.discovery.evaluators._frontier_trainability import TRAIN_PENALTY_CAP  # noqa: E402
from kernel.discovery.evaluators.trainability_frontier import HONESTY, SPEC  # noqa: E402
from kernel.trainability.convert import from_object  # noqa: E402
from kernel.trainability.ir import IrError  # noqa: E402

SIZES = [4, 6, 8, 10]
FAST = {"qubits": SIZES, "n_layers": 3}
IDS = ["ir_conversion", "ppe_class", "qubit_count", "parameter_budget", "nontrivial_variance",
       "nontrivial_algebra", "exactness"]


def config(overrides=None, stage="full"):
    return effective_config(SPEC, normalize_config(SPEC, {**FAST, **(overrides or {})}), stage)


def brick_ansatz(n, layers, entangle=True, axes="YZ"):
    qc = QuantumCircuit(n)
    theta = ParameterVector("t", len(axes) * n * layers)
    k = 0
    for _ in range(layers):
        for q in range(n):
            for axis in axes:
                getattr(qc, "r" + axis.lower())(theta[k], q)
                k += 1
        if entangle:
            for start in (0, 1):
                for q in range(start, n - 1, 2):
                    qc.cz(q, q + 1)
    return qc


def artifact(qc):
    try:
        return {"ir": from_object(qc).to_json(), "framework": "qiskit"}
    except IrError as exc:  # the sandbox hands the converter's verdict to the scorer
        return {"ir": None, "ir_error": {"code": exc.code, "message": exc.message}}


def run(builder, overrides=None, seed=1, stage="full"):
    cfg = config(overrides, stage)
    arts = [{"call_index": i, "artifact": artifact(builder(*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))]
    return SPEC.score(cfg, arts, seed, None, None, stage=stage).to_dict()


def failed(result):
    return [g["id"] for g in result["guardrails"] if g["status"] == "fail"]


def seed_like(n, layers):
    return brick_ansatz(n, layers)


# --- spec / config ------------------------------------------------------------


def test_registered_spec_contract():
    assert EVALUATORS["trainability_frontier"] is SPEC
    assert SPEC.task == "quantum_circuit" and SPEC.default_entry == "build"
    assert SPEC.entry_signature.startswith("build(n_qubits: int, n_layers: int)")
    assert [o["key"] for o in SPEC.objectives] == ["beta", "pp_exact_cost"]
    assert [o["label"] for o in SPEC.objectives][1] == "Pauli-propagation exact cost (log10 strings)"
    assert [d["key"] for d in SPEC.descriptors] == [
        "dla_fill_fraction", "light_cone_qubits", "two_qubit_gates_per_layer", "log2_dla_dimension"]
    defaults = normalize_config(SPEC, {})
    assert defaults["qubits"] == [8, 16, 32, 64] and defaults["n_layers"] == 4
    assert defaults["observable"] == "preset:local_z" and defaults["dla_probe_qubits"] == [4, 5, 6]
    assert defaults["max_parameters_per_qubit"] == 24
    assert defaults["weights"] == {"trainability": 1.0, "pp_cost": 0.5}
    assert defaults["estimation"]["target_width"] == 0.02 and defaults["estimation"]["max_frontier"] == 200000


@pytest.mark.parametrize("bad", [
    {"qubits": [8]}, {"qubits": [2, 8]}, {"qubits": [8, 200]}, {"qubits": [4, 6, 8, 10, 12, 14, 16]},
    {"qubits": [16, 8]}, {"qubits": [8, 8]}, {"n_layers": 0}, {"unknown": 1}, {"observable": "Q1"},
    {"observable": "Z40"}, {"estimation": {"max_frontier": 5}}, {"weights": {"speed": 1}}, {"weights": {"hardness": 1}},
    {"dla_probe_qubits": 12}, {"dla_probe_qubits": [4]}, {"dla_probe_qubits": [5, 4]}, {"dla_probe_qubits": [4, 12]},
    {"dla_probe_qubits": [4, 5, 6, 7]},
])
def test_invalid_configs_are_rejected(bad):
    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, bad)


def test_calls_cover_every_size_plus_every_probe():
    cfg = config({"dla_probe_qubits": [4, 5]})
    assert SPEC.calls(cfg) == [{"args": [n, 3], "kwargs": {}} for n in [*SIZES, 4, 5]]


def test_stages_screen_uses_two_sizes_and_a_tenth_of_the_frontier():
    assert [c["args"][0] for c in SPEC.calls(config(stage="screen"))] == [4, 6, 4, 5, 6]
    assert [c["args"][0] for c in SPEC.calls(config(stage="full"))] == [4, 6, 8, 10, 4, 5, 6]
    full = run(seed_like, stage="full")
    screen = run(seed_like, stage="screen")
    assert full["metrics"]["settings"]["max_frontier"] == 200000
    assert screen["metrics"]["settings"]["max_frontier"] == 20000
    assert screen["metrics"]["settings"]["sizes"] == [4, 6]
    fit = screen["metrics"]["fit"]
    assert fit["fit_method"] == "secant"  # 2 sizes: below the fitter's minimum of 4
    assert fit["beta_ci95"] is None and screen["objectives"]["beta"]["ci95"] is None  # never a zero-width CI
    assert screen["objectives"]["beta"]["fit_method"] == "secant" and fit["beta_extreme_bound"][0] <= fit["beta"]


# --- one cheating or degenerate candidate per guardrail -------------------------


def opaque(n, layers):
    qc = brick_ansatz(n, layers)
    qc.append(UnitaryGate([[0, 1], [1, 0]]), [0])
    return qc


def shared_parameter(n, layers):
    qc, theta = QuantumCircuit(n), Parameter("shared")
    for q in range(n):
        qc.ry(theta, q)
    for q in range(n - 1):
        qc.cz(q, q + 1)
    return qc


def with_t_gate(n, layers):
    qc = brick_ansatz(n, layers)
    qc.t(0)
    return qc


def wrong_width(n, layers):
    return brick_ansatz(n - 1 if n == 6 else n, layers)


def too_many_params(n, layers):
    return brick_ansatz(n, 13)  # 26 parameters per qubit > 24


def identity_like(n, layers):
    """RZ and CZ commute with a Z observable: beta would be 0 for the wrong reason."""
    return brick_ansatz(n, layers, axes="Z")


def product_ansatz(n, layers):
    return brick_ansatz(n, layers, entangle=False)


def disconnected_blocks(n, layers):
    qc = brick_ansatz(n, layers, entangle=False)
    for q in range(0, n - 1, 2):
        qc.cz(q, q + 1)
    return qc


def small_algebra(n, layers):
    """Connected, but RY + CZ generates a polynomial-dimension algebra (20 at n = 4)."""
    return brick_ansatz(n, layers, axes="Y")


def single_axis_product(n, layers):
    return brick_ansatz(n, layers, entangle=False, axes="Y")


def rich_only_at_n4(n, layers):
    """PH-H2 (a): the exact exploit, a rich ansatz when n == 4 and a product circuit otherwise."""
    return brick_ansatz(n, layers, entangle=(n == 4))


def cz_dressed_product(n, layers):
    """PH-H2 (b): a product circuit behind a CZ chain that is a no-op on |0...0>."""
    qc = QuantumCircuit(n)
    for q in range(n - 1):
        qc.cz(q, q + 1)
    return qc.compose(brick_ansatz(n, layers, entangle=False))


def x_cx_dressed_product(n, layers):
    """The same trick with basis-state permutations (X, CX with a known control) and S / Z phases."""
    qc = QuantumCircuit(n)
    qc.x(0)
    for q in range(n - 1):
        qc.cx(q, q + 1)
        qc.s(q)
        qc.cz(q, q + 1)
    return qc.compose(brick_ansatz(n, layers, entangle=False))


def pattern_switch_with_n(n, layers):
    """A brick below n = 8 but a CZ star above it, with the same bond count per layer."""
    qc = QuantumCircuit(n)
    theta = ParameterVector("t", 2 * n * layers)
    k = 0
    for _ in range(layers):
        for q in range(n):
            qc.ry(theta[k], q)
            qc.rz(theta[k + 1], q)
            k += 2
        if n < 8:
            for start in (0, 1):
                for q in range(start, n - 1, 2):
                    qc.cz(q, q + 1)
        else:
            for q in range(1, n):
                qc.cz(0, q)
    return qc


def sparse_entanglers_at_large_n(n, layers):
    """Connected everywhere, but the entangler density collapses to a single chain for n >= 8."""
    qc = QuantumCircuit(n)
    theta = ParameterVector("t", 2 * n * layers)
    k = 0
    for _ in range(layers):
        for q in range(n):
            qc.ry(theta[k], q)
            qc.rz(theta[k + 1], q)
            k += 2
        if n < 8:
            for start in (0, 1):
                for q in range(start, n - 1, 2):
                    qc.cz(q, q + 1)
    if n >= 8:
        qc.cz(0, 1)
        for q in range(1, n - 1):
            qc.cz(q, q + 1)
    return qc


CASES = [
    (opaque, "ir_conversion"),
    (shared_parameter, "ppe_class"),
    (with_t_gate, "ppe_class"),
    (wrong_width, "qubit_count"),
    (too_many_params, "parameter_budget"),
    (identity_like, "nontrivial_variance"),
    (product_ansatz, "nontrivial_algebra"),
    (single_axis_product, "nontrivial_algebra"),
    (small_algebra, "nontrivial_algebra"),
    (disconnected_blocks, "nontrivial_algebra"),
    (rich_only_at_n4, "nontrivial_algebra"),
    (cz_dressed_product, "nontrivial_algebra"),
    (x_cx_dressed_product, "nontrivial_algebra"),
    (pattern_switch_with_n, "nontrivial_algebra"),
    (sparse_entanglers_at_large_n, "nontrivial_algebra"),
]


@pytest.mark.parametrize("builder,guardrail", CASES, ids=[c[0].__name__ for c in CASES])
def test_each_cheat_is_rejected_by_exactly_its_guardrail(builder, guardrail):
    result = run(builder)
    assert result["status"] == "rejected" and result["fitness"] is None
    assert failed(result) == [guardrail]
    assert result["rejection"]["guardrail"] == guardrail
    ids = [g["id"] for g in result["guardrails"]]
    assert ids == IDS
    later = ids[ids.index(guardrail) + 1:]
    assert all(g["status"] == "skipped" for g in result["guardrails"] if g["id"] in later)
    assert all(g["status"] == "pass" for g in result["guardrails"] if g["id"] in ids[:ids.index(guardrail)])


def test_rejection_details_name_the_cause():
    assert "n=4" in run(shared_parameter)["rejection"]["message"]
    assert "Expected exactly 6 qubits" in run(wrong_width)["rejection"]["message"]
    assert "104 free parameters exceeds the budget of 96" in run(too_many_params)["rejection"]["message"]
    assert "identity-like" in run(identity_like)["rejection"]["message"]
    message = run(small_algebra)["rejection"]["message"]
    assert "<= 4n^2=64" in message and "classification" in message
    assert "independent blocks" in run(product_ansatz)["rejection"]["message"]


def test_no_parameters_is_nontrivial_variance_not_a_crash():
    def bare(n, layers):
        qc = QuantumCircuit(n)
        qc.h(0)
        return qc

    result = run(bare)
    assert failed(result) == ["nontrivial_variance"]
    assert "no free parameters" in result["rejection"]["message"]


# --- exactness WARN -------------------------------------------------------------


def test_inexact_points_warn_and_downweight_but_never_fail():
    tight = {"estimation": {"max_frontier": 10000}, "n_layers": 4}  # n = 4, 6 exact; 8, 10 stopped
    result = run(seed_like, tight)
    assert result["status"] == "scored"
    exactness = next(g for g in result["guardrails"] if g["id"] == "exactness")
    assert exactness["status"] == "warn" and "down-weighted" in exactness["detail"]
    metrics = result["metrics"]
    assert metrics["exactness"]["inexact_sizes"] and metrics["exactness"]["penalty"] > 0
    assert metrics["terms"]["inexact_penalty"] == -metrics["exactness"]["penalty"]
    assert result["compute"]["method"] == "pauli_propagation_bounded"
    assert any(not p["exact"] for p in metrics["variance_points"])


# --- scoring -------------------------------------------------------------------


@pytest.fixture(scope="module")
def scored():
    return run(seed_like, seed=3)


def test_scored_shape(scored):
    assert scored["status"] == "scored"
    assert [g["id"] for g in scored["guardrails"]] == IDS
    assert all(g["status"] == "pass" for g in scored["guardrails"])
    assert set(scored["descriptors"]) == {
        "dla_fill_fraction", "light_cone_qubits", "two_qubit_gates_per_layer", "log2_dla_dimension"}
    assert 0 <= scored["descriptors"]["log2_dla_dimension"] <= 12
    assert scored["descriptors"]["dla_fill_fraction"] == pytest.approx(1.0, abs=1e-3)  # the brick fills su(64) at n = 6
    assert scored["descriptors"]["light_cone_qubits"] == scored["metrics"]["light_cone"]["width"]
    assert scored["descriptors"]["two_qubit_gates_per_layer"] == pytest.approx(5.0)  # largest probe n=6 brick: 5 CZ per layer
    assert scored["compute"] == {"backend": "numpy", "method": "pauli_propagation_exact"}
    m = scored["metrics"]
    assert m["honesty"] == HONESTY
    assert "*Pauli propagation*" in HONESTY and "not that the circuit is classically hard" in HONESTY
    assert "It is not a proof of classical hardness." in HONESTY
    assert [p["n_qubits"] for p in m["variance_points"]] == SIZES
    assert all(p["method"] == "pauli_propagation_exact" and p["variance_ci95"][0] <= p["variance"] * (1 + 1e-12) for p in m["variance_points"])
    assert m["dla"]["dimension"] == 4095 and m["dla"]["classification"]["label"] == "su(64)"  # largest probe n = 6
    assert m["features"]["n_qubits"] == SIZES[-1] and m["features"]["entangler"] == "cz"
    assert m["censored"] is m["pp_exact_cost"]["censored"]


def test_fitness_is_the_documented_combination(scored):
    m, w = scored["metrics"], scored["metrics"]["settings"]["weights"]
    fit = m["fit"]
    assert fit["trainability_term"] == -min(fit["decay_per_doubling"], TRAIN_PENALTY_CAP)
    hardness = m["hardness"]
    assert hardness["value"] == pytest.approx(min(hardness["pp_log10_strings"], m["light_cone"]["width"] * 0.30103))
    expected = w["trainability"] * fit["trainability_term"] + w["pp_cost"] * hardness["value"]
    assert scored["fitness"] == pytest.approx(expected - m["exactness"]["penalty"])
    beta = scored["objectives"]["beta"]
    assert beta["direction"] == "minimize" and beta["fit_method"] == "weighted_log_fit"
    assert beta["ci95"][1] == pytest.approx(fit["beta_upper95"])
    cost = scored["objectives"]["pp_exact_cost"]
    assert cost["direction"] == "maximize" and cost["value"] == m["pp_exact_cost"]["log10_strings_lower"]
    assert "estimation_hardness" not in scored["objectives"]


def test_exact_cost_is_the_untruncated_frontier_peak_at_the_largest_size(scored):
    cost = scored["metrics"]["pp_exact_cost"]
    assert cost["n_qubits"] == SIZES[-1] and len(cost["points"]) == 3
    assert cost["log10_strings_lower"] == min(p["log10_strings"] for p in cost["points"])
    assert cost["strings_lower"] == min(p["frontier_peak"] for p in cost["points"])
    assert cost["censored"] is False and all(p["exact"] and not p["censored"] for p in cost["points"])
    assert "needed" in cost["statement"] and "strings to compute <O> exactly" in cost["statement"]
    l1 = SIZES[-1]  # term-normalised local_z: sum of n unit coefficients
    assert all(-l1 <= p["interval"][0] <= p["interval"][1] <= l1 for p in cost["points"])
    curve = cost["diagnostics"]["bound_width_curve"]
    assert curve["role"] == "diagnostic_only" and curve["l1_bound"] == l1
    sizes = [c["max_frontier"] for c in curve["curve"]]
    assert sizes == sorted(sizes) and sizes[0] == 100


def test_local_observable_may_scale_polynomially_and_still_score():
    result = run(lambda n, layers: brick_ansatz(n, 2), {"n_layers": 2})
    assert result["status"] == "scored"
    assert result["metrics"]["fit"]["trainability_term"] <= 0.0


def test_gradient_map_groups_parameters_by_source_line():
    cfg = config()
    arts = [
        {"call_index": i, "artifact": {"ir": _with_lines(brick_ansatz(*c["args"]))}}
        for i, c in enumerate(SPEC.calls(cfg))
    ]
    gmap = SPEC.score(cfg, arts, 1, None, None, stage="full").to_dict()["metrics"]["gradient_map"]
    assert gmap["method"] == "pauli_propagation_exact" and gmap["n_qubits"] == 4
    assert [entry["line"] for entry in gmap["lines"]] == [10, 11]
    assert all(entry["variance"] > 0 and entry["dead"] is False for entry in gmap["lines"])
    assert gmap["dead_fraction"] == 0.0


def _with_lines(qc):
    ir = from_object(qc).to_json()
    for gate in ir["gates"]:
        gate["source_line"] = {"RY": 10, "RZ": 11}.get(gate["name"])
    return ir


def test_dead_lines_are_flagged_in_the_gradient_map():
    def dead_rz(n, layers):
        qc = QuantumCircuit(n)
        a, b = ParameterVector("a", n), ParameterVector("b", n)
        for q in range(n):
            qc.ry(a[q], q)
        for q in range(n - 1):
            qc.cx(q, q + 1)
        for q in range(n):
            qc.rz(b[q], q)  # trailing RZ commutes with a Z observable
        return qc

    cfg = config()
    arts = [{"call_index": i, "artifact": {"ir": _with_lines(dead_rz(*c["args"]))}} for i, c in enumerate(SPEC.calls(cfg))]
    result = SPEC.score(cfg, arts, 1, None, None, stage="full").to_dict()
    if result["status"] == "scored":
        flags = {e["line"]: e["dead"] for e in result["metrics"]["gradient_map"]["lines"]}
        assert flags.get(11) is True and flags.get(10) is False
    else:  # a small algebra is also a legitimate rejection; the dead flag is then moot
        assert failed(result)


# --- determinism / stages -------------------------------------------------------


def test_deterministic_per_seed_and_independent_across_seeds(scored):
    again = run(seed_like, seed=3)
    assert again == scored
    other = run(seed_like, seed=4)
    assert other["metrics"]["variance_points"] == scored["metrics"]["variance_points"]  # exact PPE: no randomness
    values = lambda r: [p["value"] for p in r["metrics"]["pp_exact_cost"]["points"]]  # noqa: E731
    assert values(other) != values(scored)


def test_confirm_uses_an_independent_probe_stream_with_identical_variances(scored):
    confirm = run(seed_like, seed=3, stage="confirm")
    assert confirm["metrics"]["variance_points"] == scored["metrics"]["variance_points"]
    values = lambda r: [p["value"] for p in r["metrics"]["pp_exact_cost"]["points"]]  # noqa: E731
    assert values(confirm) != values(scored)
    assert confirm["metrics"]["settings"]["stage"] == "confirm"


def test_cancel_before_scoring_is_reported_as_cancelled():
    import threading

    cfg = config()
    arts = [{"call_index": i, "artifact": artifact(seed_like(*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))]
    event = threading.Event()
    event.set()
    result = SPEC.score(cfg, arts, 1, None, event, stage="full").to_dict()
    assert result["status"] == "failed" and result["failure"]["code"] == "cancelled"
