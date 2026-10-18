"""``trainability_frontier`` — hunting for counterexamples to a conjecture (PRD 14 addendum B).

Cerezo et al. (arXiv:2312.09121) conjecture that every provably barren-plateau-free ansatz
is classically simulable. This evaluator scores a candidate ansatz family ``build(n, L)`` on
two axes that the conjecture says cannot both be good:

* **trainability**: the exact Pauli-propagation (PPE) gradient variance at each size, fitted
  as ``Var ~ 2^(-beta n)``. The fitness term is ``-max(beta_upper95, 0)`` (upper 95% bound
  of beta even when a polynomial law is preferred; flat or growing variance earns 0).
* **estimation hardness**: how large a PPE frontier is needed to pin ``<O>`` to
  ``target_width`` at the largest size (``log10``, pessimistic over 3 seeded points).

Honesty (mandatory): hardness is resistance to *this* Pauli-propagation estimator under
*this* budget. It is not a proof of classical hardness. A high score is a lead to
investigate, not a counterexample. Both numbers carry intervals and method labels, and a
probe that exhausts the budget is reported as censored, never as a measured value.

Guardrails (first-fail, in order): ``ir_conversion``, ``ppe_class``, ``qubit_count``,
``parameter_budget``, ``nontrivial_variance`` (stops "beta = 0 because nothing depends on
theta"), ``nontrivial_algebra`` (DLA dimension > 2n and no tensor-product structure: stops
trivially trainable *and* trivially simulable product circuits) and ``exactness`` (WARN
only: inexact variance points subtract ``INEXACT_PENALTY`` times their fraction).
"""

from __future__ import annotations

import threading
from typing import Any, Callable

from kernel.discovery.evaluators._circuit_common import (
    CircuitHolder,
    ir_conversion_check,
    parameter_budget_check,
    qubit_count_check,
)
from kernel.discovery.evaluators._frontier_config import (
    CONFIG_SCHEMA,
    DEFAULT_CONFIG,
    STAGES,
    calls,
    effective_sizes,
    frontier_cap,
    validate_extra,
)
from kernel.discovery.evaluators._frontier_metrics import (
    algebra_verdict,
    dla_probe,
    ppe_gradient_map,
    structure_problem,
    two_qubit_gates_per_layer,
)
from kernel.discovery.evaluators._frontier_structure import strip_trivial_prefix
from kernel.discovery.evaluators._frontier_probe import (
    fit_beta,
    hardness_probe,
    is_exact_point,
    public_point,
    variance_point,
)
from kernel.discovery.evaluators.base import EvaluationCore, EvaluatorSpec
from kernel.discovery.evaluators.guardrails import FAIL, PASS, WARN, CheckResult, Guardrail, run_guardrails
from kernel.discovery.features import extract_features
from kernel.trainability._analysis_common import AnalysisCancelled
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.pauli import ObservableError, PauliSum, parse_observable
from kernel.trainability.pauliprop import ppe_applicable

KIND = "trainability_frontier"
VERSION = "1.0.0"
MIN_VARIANCE = 1e-6
INEXACT_PENALTY = 1.0
HONESTY = (
    "Hardness is resistance to *this* Pauli-propagation estimator under *this* budget. "
    "It is not a proof of classical hardness. A high score is a lead to investigate, not a counterexample."
)


class _Run:
    """Per-evaluation state: parsed circuits and lazily computed, cached PPE variance points."""

    def __init__(self, config: dict[str, Any], artifacts: list[dict[str, Any]], stage: str, cancel) -> None:
        self.config, self.stage = config, stage
        self.sizes = effective_sizes(config)
        self.probes: list[int] = list(config["dla_probe_qubits"])
        by_index = {a.get("call_index"): a.get("artifact") for a in artifacts}
        self.artifacts = [by_index.get(i) for i in range(len(self.sizes) + len(self.probes))]
        self.holders = [CircuitHolder() for _ in self.artifacts]
        self.cancel: Callable[[], bool] | None = cancel.is_set if cancel is not None else None
        self.max_frontier = frontier_cap(config, stage)
        self.points: dict[int, dict[str, Any]] = {}
        self.dlas: list[dict[str, Any]] = []

    @property
    def expected(self) -> list[int]:
        return [*self.sizes, *self.probes]

    def circuit(self, n: int) -> ParamCircuit:
        circuit = self.holders[self.sizes.index(n)].circuit
        assert circuit is not None
        return circuit

    def probe_circuit(self, index: int) -> ParamCircuit:
        circuit = self.holders[len(self.sizes) + index].circuit
        assert circuit is not None
        return circuit

    @property
    def dla(self) -> dict[str, Any]:
        """The DLA record at the largest probe size (the descriptor's source)."""
        return self.dlas[-1]

    def observable(self, circuit: ParamCircuit, expected: int) -> PauliSum:
        """The observable on the circuit's own width (so a width bug is ``qubit_count``'s to report)."""
        try:
            return parse_observable(self.config["observable"], circuit.n_qubits)
        except ObservableError:
            return parse_observable(self.config["observable"], expected)

    def point(self, n: int) -> dict[str, Any]:
        if n not in self.points:
            est = self.config["estimation"]
            circuit = self.circuit(n)
            self.points[n] = variance_point(
                circuit, self.observable(circuit, n), max_frontier=self.max_frontier,
                time_budget_s=est["time_budget_s"], n_layers=self.config["n_layers"], cancel=self.cancel,
            )
        return self.points[n]


def _each_call(run: _Run, check: Callable[[int, int], CheckResult]) -> CheckResult:
    for index, n in enumerate(run.expected):
        status, detail = check(index, n)
        if status == FAIL:
            return FAIL, f"build({n}, {run.config['n_layers']}): {detail}"
    return PASS, None


def _ir_check(run: _Run) -> CheckResult:
    return _each_call(run, lambda i, n: ir_conversion_check(run.holders[i], run.artifacts[i]))


def _ppe_class_check(run: _Run) -> CheckResult:
    for n in run.sizes:
        circuit = run.circuit(n)
        ok, reason = ppe_applicable(circuit, run.observable(circuit, n), init="uniform")
        if not ok:
            return FAIL, f"n={n}: {reason}"
    return PASS, None


def _budget_check(run: _Run) -> CheckResult:
    limit = run.config["max_parameters_per_qubit"]
    return _each_call(run, lambda i, n: parameter_budget_check(run.holders[i], limit * n))


def _variance_check(run: _Run) -> CheckResult:
    n = run.sizes[0]
    if not run.circuit(n).parameters:
        return FAIL, f"At n={n} the circuit has no free parameters, so its gradient variance is trivially zero."
    variance = run.point(n)["variance"]
    if variance < MIN_VARIANCE:
        return FAIL, (
            f"At n={n} the mean gradient variance is {variance:.3e} < {MIN_VARIANCE:.0e}: "
            "the observable barely depends on the parameters (an identity-like circuit would score beta = 0 trivially)."
        )
    return PASS, f"n={n}: mean gradient variance {variance:.3e}"


def _algebra_check(run: _Run) -> CheckResult:
    """Per-size product test, cross-size consistency, then the DLA at every probe size."""
    stripped = {n: strip_trivial_prefix(run.circuit(n)) for n in run.sizes}
    probes = [strip_trivial_prefix(run.probe_circuit(i)) for i in range(len(run.probes))]
    problem = structure_problem({**stripped, **dict(zip(run.probes, probes))}, run.config["n_layers"])
    if problem:
        return FAIL, problem
    run.dlas = []
    details = []
    for index, item in enumerate(probes):
        circuit = run.probe_circuit(index)
        probe = dla_probe(circuit, run.cancel)
        run.dlas.append(probe)
        ok, detail = algebra_verdict(circuit, probe, item)
        if not ok:
            return FAIL, detail
        details.append(detail)
    return PASS, " ".join(details)


def _exactness_check(run: _Run) -> CheckResult:
    loose = [n for n in run.sizes if not is_exact_point(run.point(n))]
    if not loose:
        return PASS, None
    return WARN, (
        f"The variance interval is wider than 10% of the estimate at n={loose}; "
        f"those points are down-weighted (fitness penalty {INEXACT_PENALTY} x their fraction)."
    )


def _guardrails(run: _Run) -> list[Guardrail]:
    return [
        Guardrail("ir_conversion", "Circuit converts for every n", lambda: _ir_check(run)),
        Guardrail("ppe_class", "Independent single-Pauli rotations, Clifford fixed gates", lambda: _ppe_class_check(run)),
        Guardrail("qubit_count", "Exactly n qubits for every n", lambda: _each_call(
            run, lambda i, n: qubit_count_check(run.holders[i], n))),
        Guardrail(
            "parameter_budget", f"At most {run.config['max_parameters_per_qubit']} parameters per qubit",
            lambda: _budget_check(run)),
        Guardrail("nontrivial_variance", "Gradient variance is not trivially zero", lambda: _variance_check(run)),
        Guardrail("nontrivial_algebra", "Dynamical Lie algebra above 4n^2, connected and consistent at every size", lambda: _algebra_check(run)),
        Guardrail("exactness", "Variance points are exact", lambda: _exactness_check(run)),
    ]


def _cancelled() -> EvaluationCore:
    return EvaluationCore(
        status="failed", failure={"stage": "score", "code": "cancelled", "message": "Evaluation was cancelled."}
    )


def _objectives(fit: dict[str, Any], hardness: dict[str, Any]) -> dict[str, Any]:
    return {
        "beta": {
            "value": fit["beta"], "ci95": list(fit["beta_ci95"]), "direction": "minimize",
            "label": "Barren-plateau exponent beta",
        },
        "estimation_hardness": {
            "value": hardness["hardness_lower"], "direction": "maximize",
            "label": "Estimation hardness (log10 frontier)",
        },
    }


def score(
    config: dict[str, Any],
    artifacts: list[dict[str, Any]],
    seed: int,
    progress: Callable[[float, str], None] | None = None,
    cancel: threading.Event | None = None,
    stage: str = "full",
    cache_dir: str | None = None,
) -> EvaluationCore:
    run = _Run(config, artifacts, stage, cancel)
    try:
        records, rejection = run_guardrails(_guardrails(run))
        if cancel is not None and cancel.is_set():
            return _cancelled()
        if rejection is not None:
            return EvaluationCore(status="rejected", guardrails=records, rejection=rejection)
        return _scored(run, records, seed, progress)
    except AnalysisCancelled:
        return _cancelled()


def _scored(
    run: _Run, records: list[dict[str, Any]], seed: int, progress: Callable[[float, str], None] | None
) -> EvaluationCore:
    config, est = run.config, run.config["estimation"]
    points = [run.point(n) for n in run.sizes]
    if progress is not None:
        progress(0.5, "estimation hardness probe")
    largest = run.circuit(run.sizes[-1])
    hardness = hardness_probe(
        largest, run.observable(largest, run.sizes[-1]), seed=seed, stage=run.stage,
        target_width=est["target_width"], max_frontier=run.max_frontier,
        time_budget_s=est["time_budget_s"], cancel=run.cancel,
    )
    fit = fit_beta(points, seed)
    weights = config["weights"]
    inexact = [p["n_qubits"] for p in points if not is_exact_point(p)]
    penalty = INEXACT_PENALTY * len(inexact) / len(points)
    terms = {
        "trainability": weights["trainability"] * fit["trainability_term"],
        "hardness": weights["hardness"] * hardness["hardness_lower"],
        "inexact_penalty": -penalty,
    }
    fitness = sum(terms.values())
    features = extract_features(largest, n_layers=config["n_layers"])
    probe_features = extract_features(run.probe_circuit(len(run.probes) - 1), n_layers=config["n_layers"])
    dla = run.dla
    assert dla is not None
    smallest = run.circuit(run.sizes[0])
    exact = all(p["method"] == "pauli_propagation_exact" for p in points)
    metrics = {
        "variance_points": [public_point(p) for p in points],
        "fit": {k: v for k, v in fit.items()},
        "hardness": hardness,
        "censored": hardness["censored"],
        "dla": dla,
        "features": features,
        "gradient_map": ppe_gradient_map(smallest, points[0], config["observable"]),
        "terms": terms,
        "exactness": {"inexact_sizes": inexact, "penalty": penalty},
        "settings": {
            "stage": run.stage, "sizes": run.sizes, "n_layers": config["n_layers"],
            "observable": config["observable"], "max_frontier": run.max_frontier,
            "time_budget_s": est["time_budget_s"], "target_width": est["target_width"],
            "dla_probe_qubits": run.probes, "weights": dict(weights),
        },
        "honesty": HONESTY,
    }
    return EvaluationCore(
        status="scored",
        fitness=float(fitness),
        objectives=_objectives(fit, hardness),
        descriptors={
            "log2_dla_dimension": round(dla["log2_dimension"], 4),
            "two_qubit_gates_per_layer": round(two_qubit_gates_per_layer(probe_features), 4),
        },
        metrics=metrics,
        guardrails=records,
        compute={
            "backend": "numpy",
            "method": "pauli_propagation_exact" if exact else "pauli_propagation_bounded",
        },
    )


SPEC = EvaluatorSpec(
    kind=KIND,
    version=VERSION,
    title="Trainability frontier",
    description=(
        "Search for ansatzes that stay trainable (low barren-plateau exponent, exact at 8-64 qubits via "
        "Pauli propagation) yet resist that estimator. A high score is a lead to investigate, not a "
        "counterexample to the Cerezo et al. simulability conjecture (arXiv:2312.09121)."
    ),
    task="quantum_circuit",
    entry_signature="build(n_qubits: int, n_layers: int) -> QuantumCircuit | cirq.Circuit",
    objectives=[
        {"key": "beta", "label": "Barren-plateau exponent beta", "direction": "minimize"},
        {"key": "estimation_hardness", "label": "Estimation hardness (log10 frontier)", "direction": "maximize"},
    ],
    descriptors=[
        {"key": "log2_dla_dimension", "label": "log2 DLA dimension", "min": 0, "max": 12, "default_bins": 8},
        {"key": "two_qubit_gates_per_layer", "label": "Two-qubit gates per layer", "min": 0, "max": 64, "default_bins": 8},
    ],
    config_schema=CONFIG_SCHEMA,
    default_config=DEFAULT_CONFIG,
    stages=STAGES,
    calls=calls,
    score=score,
    validate_extra=validate_extra,
)
