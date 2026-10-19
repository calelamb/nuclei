"""Red Queen audits: honest seeds, planted exploits, verdict logic, registry, fingerprints (PRD 14 addendum F)."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import threading

import numpy as np
import pytest

pytest.importorskip("stim")
pytest.importorskip("pymatching")
pytest.importorskip("qiskit")

from kernel.discovery import cost as cost_module  # noqa: E402
from kernel.discovery.audits import (  # noqa: E402
    AuditUnavailable, available_audits, has_audit, load_audit,
)
from kernel.discovery.audits import audit_worker, runner, state_synthesis as ss_audit, vqe_ground_state as vqe_audit  # noqa: E402
from kernel.discovery.audits import qec_memory as qec_audit  # noqa: E402
from kernel.discovery.audits.runner import AuditRequest, audit_fingerprint, decide, derive_audit_seed, run_audit_job  # noqa: E402
from kernel.discovery.evaluators import EVALUATORS  # noqa: E402
from kernel.discovery.evaluators.base import source_closure  # noqa: E402
from kernel.discovery.hamiltonians import build_hamiltonian  # noqa: E402
from kernel.tests._discovery_audit_helpers import (  # noqa: E402
    HONEST_SEEDS, QEC_CONFIG, SS_CONFIG, VQE_CONFIG, full_config, honest_artifacts, honest_evaluation, read_seed,
)
from kernel.trainability.pauli import pauli_sum_matrix  # noqa: E402

ISOLATION_ENV = "NUCLEI_DISCOVERY_ISOLATION"


@pytest.fixture(autouse=True)
def _process_isolation(monkeypatch):
    monkeypatch.setenv(ISOLATION_ENV, "process")
    from kernel.discovery import isolation

    isolation.reset_for_tests()
    yield
    isolation.reset_for_tests()


def status_of(record: dict, check_id: str) -> str:
    (match,) = [c for c in record["checks"] if c["id"] == check_id]
    return match["status"]


def run_audit_for(name: str, evaluation=None, artifacts=None, seed: int = 123) -> dict:
    kind, _, config = HONEST_SEEDS[name]
    module = load_audit(kind)
    return module.audit(
        full_config(kind, config), artifacts if artifacts is not None else honest_artifacts(name), seed,
        evaluation=evaluation if evaluation is not None else honest_evaluation(name), cancel=threading.Event(),
    )


# --- honest seeds: the full job (fresh sandbox + trusted subprocess) says consistent ----------------


@pytest.mark.parametrize("name", sorted(HONEST_SEEDS))
def test_honest_seed_is_consistent_end_to_end(name):
    kind, filename, config = HONEST_SEEDS[name]
    evaluation = honest_evaluation(name)
    assert evaluation["status"] == "scored"
    request = AuditRequest("r", "c", kind, _normalized(kind, config),
                           read_seed(filename), "build", 11, evaluation)
    record = run_audit_job(request, threading.Event())
    assert record["verdict"] == "consistent", (record["reasons"], [c for c in record["checks"] if c["status"] != "pass"])
    assert all(c["status"] in ("pass", "warn") for c in record["checks"])
    assert record["evaluator_fitness"] == evaluation["fitness"]
    assert isinstance(record["audit_fitness"], float)
    assert record["gap"] == pytest.approx(evaluation["fitness"] - record["audit_fitness"])
    assert record["seed"] == 11 and record["audit_seed"] == derive_audit_seed(11) != 11
    assert re.fullmatch(r"[0-9a-f]{64}", record["audit_fingerprint"])
    assert record["evaluator"]["kind"] == kind and re.fullmatch(r"[0-9a-f]{64}", record["evaluator"]["fingerprint"])
    assert set(record["timings_ms"]) == {"sandbox", "audit", "total"} and record["timings_ms"]["audit"] > 0
    assert record["isolation"] == "process" and isinstance(record["notes"], list)
    assert record["checks"][0]["id"] == "candidate_deterministic"


def _normalized(kind, config):
    from kernel.discovery.evaluators import normalize_config

    return normalize_config(EVALUATORS[kind], config)


def test_audit_seed_is_derived_and_deterministic():
    assert derive_audit_seed(7) == derive_audit_seed(7)
    assert derive_audit_seed(7) != derive_audit_seed(8)
    assert 0 <= derive_audit_seed(7) < 2**63 and derive_audit_seed(7) != 7


# --- qec_memory planted exploits ----------------------------------------------------------------------


def test_qec_audit_flags_a_ler_interval_that_does_not_overlap():
    evaluation = copy.deepcopy(honest_evaluation("qec_repetition"))
    evaluation["metrics"]["per_distance"][0]["ci95"] = [0.4, 0.45]
    record = run_audit_for("qec_repetition", evaluation=evaluation)
    assert status_of(record, "ler_matches_evaluator") == "fail"


def test_qec_audit_catches_noise_smuggled_into_the_fresh_artifact():
    artifacts = copy.deepcopy(honest_artifacts("qec_repetition"))
    artifacts[0]["artifact"]["circuit_text"] = "X_ERROR(0.001) 0\n" + artifacts[0]["artifact"]["circuit_text"]
    assert status_of(run_audit_for("qec_repetition", artifacts=artifacts), "noiseless") == "fail"


def test_qec_audit_exact_search_catches_a_circuit_below_its_requested_distance():
    # The d=5 slot holds the d=3 repetition code: an undetectable weight-3 logical exists.
    artifacts = copy.deepcopy(honest_artifacts("qec_repetition"))
    artifacts[1]["artifact"] = copy.deepcopy(artifacts[0]["artifact"])
    record = run_audit_for("qec_repetition", artifacts=artifacts)
    assert status_of(record, "exact_fault_distance") == "fail"
    detail = [c for c in record["checks"] if c["id"] == "exact_fault_distance"][0]["detail"]
    assert "weight 3" in detail


def test_qec_audit_reports_a_missing_artifact_as_failed_parse():
    record = qec_audit.audit(full_config("qec_memory", QEC_CONFIG), [], 1, evaluation={"status": "scored"})
    assert record["checks"][0]["id"] == "parse" and record["checks"][0]["status"] == "fail"


def test_qec_audit_alternate_noise_models():
    assert qec_audit.ALT_MODEL == {"si1000": "uniform", "uniform": "si1000", "biased_z": "uniform"}
    config = full_config("qec_memory", {**QEC_CONFIG, "noise": {"model": "si1000", "p": 1e-3}})
    record = qec_audit.audit(config, honest_artifacts("qec_repetition"), 5, evaluation={"status": "scored", "metrics": {}})
    assert any("uniform" in n for n in record["notes"])


def test_qec_evaluator_now_rejects_the_distance_cheater_and_the_audit_agrees():
    """d=7 circuit with a hidden weight-5 logical: the evaluator rejects it; the audit's exact search concurs."""
    from kernel.discovery.audits.exploits import evaluate_fixture, load_fixtures
    import tempfile

    fixtures = {f["id"]: f for f in load_fixtures(os.path.join(os.path.dirname(__file__), "fixtures", "exploits"))}
    with tempfile.TemporaryDirectory() as cache:
        evaluation = evaluate_fixture(fixtures["qec-distance-cheater-bus-fanout"], cache)
    assert evaluation["status"] == "rejected" and evaluation["rejection"]["guardrail"] == "fault_distance"
    # the audit-side half of this (exact search finds weight 5 even when the evaluator is blind) lives in test_discovery_holes.py


# --- state_synthesis planted exploits -----------------------------------------------------------------


def test_state_audit_flags_an_overclaimed_fidelity_for_a_parameter_free_circuit():
    evaluation = copy.deepcopy(honest_evaluation("w_state"))
    evaluation["metrics"]["fidelity"] = 0.4
    artifacts = _product_state_artifacts()
    record = run_audit_for("w_state", evaluation=evaluation, artifacts=artifacts)
    assert status_of(record, "fidelity_reproduced") == "fail"
    assert record["audit_fitness"] < evaluation["fitness"]


def _product_state_artifacts():
    from kernel.trainability.ir import IrGate, ParamCircuit

    circuit = ParamCircuit(3, [IrGate("H", (q,), ()) for q in range(3)], [], "native", [])
    return [{"call_index": 0, "artifact": {"ir": circuit.to_json(), "framework": "native"}}]


def test_state_audit_cost_decomposition_catches_a_gate_priced_below_its_compiled_cost(monkeypatch):
    table = dict(cost_module._TABLE)
    table["CX"] = (2, 0)
    monkeypatch.setattr(cost_module, "_TABLE", table)
    record = run_audit_for("w_state")
    assert status_of(record, "cost_decomposition") == "fail"


def test_state_audit_flags_descriptor_mismatch():
    evaluation = copy.deepcopy(honest_evaluation("w_state"))
    evaluation["descriptors"]["two_qubit_gates"] = 1
    assert status_of(run_audit_for("w_state", evaluation=evaluation), "cost_decomposition") == "fail"


def test_state_audit_flags_a_compiler_that_disagrees_with_the_oracle(monkeypatch):
    real = ss_audit.compile_circuit

    class Liar:
        def __init__(self, program):
            self._program = program

        def states(self, values):
            out = np.array(self._program.states(values))
            out[..., [0, 1]] = out[..., [1, 0]]
            return out

    monkeypatch.setattr(ss_audit, "compile_circuit", lambda circuit: Liar(real(circuit)))
    assert status_of(run_audit_for("w_state"), "oracle_vs_compiler") == "fail"


def test_state_audit_rejects_measured_circuits():
    artifacts = copy.deepcopy(honest_artifacts("w_state"))
    artifacts[0]["artifact"]["ir"]["notes"] = ["dropped 3 measurement(s)"]
    assert status_of(run_audit_for("w_state", artifacts=artifacts), "no_measurement") == "fail"


def test_state_audit_independent_qiskit_rebuild_matches_cx_counts():
    from kernel.trainability.ir import ParamCircuit

    circuit = ParamCircuit.from_json(honest_artifacts("w_state")[0]["artifact"]["ir"])
    assert ss_audit.transpiled_cx_count(circuit, np.zeros(0)) == 6  # three CX per cascade step, two steps for three qubits


def test_state_audit_reoptimizes_when_best_theta_is_missing():
    from kernel.discovery.seeds.tfim_ansatz import build  # parameterized circuit as a stand-in IR source
    from kernel.trainability.convert import from_object

    ir = from_object(build(3)).to_json()
    artifacts = [{"call_index": 0, "artifact": {"ir": ir, "framework": "qiskit"}}]
    config = full_config("state_synthesis", {"target": {"kind": "ghz", "n_qubits": 3}, "optimize_parameters": {"restarts": 2, "steps": 40}})
    record = ss_audit.audit(config, artifacts, 3, evaluation={"status": "scored", "metrics": {"fidelity": 0.2}, "fitness": 1.0})
    assert status_of(record, "oracle_vs_compiler") == "pass"
    assert any("fresh re-optimization" in n for n in record["notes"])


# --- vqe planted exploits -----------------------------------------------------------------------------


def test_vqe_dense_hamiltonians_match_the_evaluators_pauli_sums():
    for spec in (
        {"kind": "tfim", "n_qubits": 4, "h": 0.7, "periodic": True},
        {"kind": "heisenberg", "n_qubits": 3, "periodic": False},
        {"kind": "xxz", "n_qubits": 4, "delta": 0.3, "periodic": True},
        {"kind": "pauli", "n_qubits": 3, "pauli": "0.5*Z0*Z2 - X1"},
    ):
        mine = vqe_audit.dense_hamiltonian(spec)
        theirs = pauli_sum_matrix(build_hamiltonian(spec), spec["n_qubits"])
        assert np.allclose(mine, theirs, atol=1e-12), spec


def test_vqe_audit_flags_a_wrong_ground_energy_and_a_bound_violation():
    evaluation = copy.deepcopy(honest_evaluation("tfim_ansatz"))
    wrong = copy.deepcopy(evaluation)
    wrong["metrics"]["e0"] += 0.01
    assert status_of(run_audit_for("tfim_ansatz", evaluation=wrong), "ground_energy") == "fail"
    below = copy.deepcopy(evaluation)
    below["metrics"]["e_best"] = below["metrics"]["e0"] - 1.0
    assert status_of(run_audit_for("tfim_ansatz", evaluation=below), "variational_bound") == "fail"


def test_vqe_audit_flags_a_hamiltonian_the_evaluator_built_differently(monkeypatch):
    from kernel.discovery.hamiltonians import tfim

    monkeypatch.setattr(vqe_audit, "build_hamiltonian", lambda spec: tfim(spec["n_qubits"], 2.0))
    assert status_of(run_audit_for("tfim_ansatz"), "hamiltonian_rebuilt") == "fail"


def test_vqe_audit_prefilter_fails_when_variance_is_below_threshold_under_a_new_seed():
    config = full_config("vqe_ground_state", VQE_CONFIG)
    config["trainability_prefilter"]["min_variance"] = 1000.0
    record = vqe_audit.audit(config, honest_artifacts("tfim_ansatz"), 9, evaluation=honest_evaluation("tfim_ansatz"))
    assert status_of(record, "prefilter_variance") == "fail"


def test_vqe_audit_is_skipped_beyond_the_dense_size_limit():
    config = full_config("vqe_ground_state", {"hamiltonian": {"n_qubits": 12}})
    record = vqe_audit.audit(config, [{"call_index": 0, "artifact": {"ir": _tiny_ir(12), "framework": "native"}}], 1,
                             evaluation={"status": "scored"})
    assert status_of(record, "dense_oracle") == "skipped"


def _tiny_ir(n):
    from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef

    return ParamCircuit(n, [IrGate("RY", (0,), (ParamRef("t"),))], ["t"], "native", []).to_json()


# --- verdict logic ------------------------------------------------------------------------------------


def checks(*pairs):
    return [{"id": cid, "label": cid, "status": st, "detail": f"{cid} {st}"} for cid, st in pairs]


def test_decide_rules():
    assert decide("scored", checks(("a", "pass"), ("b", "warn"))) == ("consistent", [])
    verdict, reasons = decide("scored", checks(("a", "fail"), ("b", "skipped")))
    assert verdict == "exploit" and reasons == ["a: a fail"]
    assert decide("scored", checks(("a", "pass"), ("b", "skipped")))[0] == "inconclusive"
    assert decide("rejected", checks(("a", "fail")))[0] == "consistent"
    assert decide("rejected", checks(("a", "pass")))[0] == "inconclusive"


def _stub_sandbox(artifacts_list):
    calls = iter(artifacts_list)

    def run(request, *, wall_seconds, cancel_event=None):
        reply = next(calls)
        return reply if "status" in reply else {"status": "ok", "artifacts": reply["artifacts"], "isolation": "process"}

    return run


def _job(evaluation_status="scored"):
    config = _normalized("state_synthesis", SS_CONFIG)
    return AuditRequest("r", "c", "state_synthesis", config, "pass\n", "build", 5, {"status": evaluation_status, "fitness": 3.0})


def _stub_worker(checks_, fitness=2.5):
    return lambda *args, **kwargs: {"checks": checks_, "audit_fitness": fitness, "notes": ["n"]}


def test_runner_nondeterministic_candidate_is_an_exploit():
    sandbox = _stub_sandbox([{"artifacts": [{"call_index": 0, "artifact": {"x": 1}}]}, {"artifacts": [{"call_index": 0, "artifact": {"x": 2}}]}])
    record = run_audit_job(_job(), threading.Event(), sandbox_runner=sandbox, worker_runner=_stub_worker([]))
    assert record["verdict"] == "exploit" and status_of(record, "candidate_deterministic") == "fail"
    assert record["gap"] == pytest.approx(0.5)


def test_runner_sandbox_failure_semantics():
    boom = {"status": "error", "error": {"code": "entry_raised", "message": "x"}, "artifacts": [], "isolation": "process"}
    slow = {"status": "error", "error": {"code": "worker_timeout", "message": "x"}, "artifacts": [], "isolation": "process"}
    scored = run_audit_job(_job(), threading.Event(), sandbox_runner=_stub_sandbox([boom]), worker_runner=_stub_worker([]))
    assert scored["verdict"] == "exploit" and status_of(scored, "sandbox_reproducible") == "fail"
    transient = run_audit_job(_job(), threading.Event(), sandbox_runner=_stub_sandbox([slow]), worker_runner=_stub_worker([]))
    assert transient["verdict"] == "inconclusive"
    unscored = run_audit_job(_job("rejected"), threading.Event(), sandbox_runner=_stub_sandbox([boom]), worker_runner=_stub_worker([]))
    assert unscored["verdict"] == "inconclusive"


def test_runner_budget_overrun_and_worker_failures_are_inconclusive():
    same = [{"artifacts": [{"call_index": 0, "artifact": {}}]}] * 2
    for code in ("budget_exceeded", "audit_exception", "audit_unavailable"):
        worker = lambda *a, code=code, **k: {"failure": {"code": code, "message": "m"}}  # noqa: E731
        record = run_audit_job(_job(), threading.Event(), sandbox_runner=_stub_sandbox(list(same)), worker_runner=worker)
        assert record["verdict"] == "inconclusive" and status_of(record, "audit_run") == "skipped"
        assert code in record["reasons"][0]


def test_runner_exploit_when_any_audit_check_fails_and_gap_is_none_without_audit_fitness():
    same = [{"artifacts": [{"call_index": 0, "artifact": {}}]}] * 2
    worker = _stub_worker(checks(("fid", "fail")), fitness=None)
    record = run_audit_job(_job(), threading.Event(), sandbox_runner=_stub_sandbox(list(same)), worker_runner=worker)
    assert record["verdict"] == "exploit" and record["gap"] is None


def test_runner_cancelled_before_start_is_inconclusive():
    event = threading.Event()
    event.set()
    record = run_audit_job(_job(), event, sandbox_runner=_stub_sandbox([]), worker_runner=_stub_worker([]))
    assert record["verdict"] == "inconclusive" and record["reasons"]


# --- audit worker -------------------------------------------------------------------------------------


def test_audit_worker_output_validation():
    good = {"checks": [{"id": "a", "label": "A", "status": "pass", "detail": None}], "audit_fitness": 1, "notes": ["x"]}
    assert audit_worker.validate_output(good)["audit_fitness"] == 1.0
    for bad in (
        None, {"checks": "no"}, {"checks": [{"id": "a", "status": "maybe"}]},
        {"checks": [], "audit_fitness": "high"}, {"checks": [], "notes": "x"},
    ):
        with pytest.raises(ValueError):
            audit_worker.validate_output(bad)


def test_audit_worker_subprocess_protocol_errors():
    def call(payload: bytes) -> dict:
        proc = subprocess.run([sys.executable, "-I", runner._WORKER_PATH], input=payload, capture_output=True, timeout=120)
        return json.loads(proc.stdout.decode())

    assert call(b"not json")["failure"]["code"] == "protocol_error"
    unknown = call(json.dumps({"protocol_version": 1, "kind": "no_such_kind", "config": {}, "artifacts": [], "seed": 1}).encode())
    assert unknown["failure"]["code"] == "audit_unavailable"
    ok = call(json.dumps({
        "protocol_version": 1, "kind": "state_synthesis", "config": full_config("state_synthesis", SS_CONFIG),
        "artifacts": honest_artifacts("w_state"), "seed": 3, "evaluation": honest_evaluation("w_state"),
    }).encode())
    assert "failure" not in ok and ok["checks"] and ok["audit_fitness"] is not None


# --- registry and fingerprints ------------------------------------------------------------------------


def test_registry_loads_by_naming_convention():
    assert {"qec_memory", "state_synthesis", "vqe_ground_state"} <= set(available_audits())
    for kind in EVALUATORS:
        assert has_audit(kind)
        assert load_audit(kind).__name__ == f"kernel.discovery.audits.{kind}"
    for bad in ("handlers", "runner", "audit_worker", "exploits", "../x", "Qec", "", "no_such_kind", "_common"):
        assert not has_audit(bad)
    with pytest.raises(AuditUnavailable):
        load_audit("no_such_kind")


def test_registry_picks_up_a_new_audit_module_without_edits(tmp_path, monkeypatch):
    import kernel.discovery.audits as package

    (tmp_path / "toy_kind.py").write_text(
        "def audit(config, artifacts, seed, *, evaluation, progress=None, cancel=None, cache_dir=None):\n"
        "    return {'checks': [], 'audit_fitness': None, 'notes': []}\n"
    )
    monkeypatch.setattr(package, "_HERE", str(tmp_path))
    monkeypatch.setattr(package, "__path__", [*package.__path__, str(tmp_path)])
    assert has_audit("toy_kind") and "toy_kind" in available_audits()
    assert load_audit("toy_kind").audit({}, [], 0, evaluation={})["checks"] == []


def test_audit_fingerprint_is_stable_per_kind_and_covers_imports():
    prints = {kind: audit_fingerprint(kind) for kind in EVALUATORS}
    assert prints == {kind: audit_fingerprint(kind) for kind in EVALUATORS}
    assert len(set(prints.values())) == len(prints) and all(re.fullmatch(r"[0-9a-f]{64}", p) for p in prints.values())
    closure = source_closure("kernel.discovery.audits.qec_memory")
    assert {"kernel.discovery.audits.qec_memory", "kernel.discovery.audits._common", "kernel.discovery.noise",
            "kernel.discovery.evaluators.qec_guardrails", "kernel.discovery.audits._exact_distance"} <= set(closure)
    assert "kernel.discovery.audits" not in closure  # the registry __init__ never changes a fingerprint


def test_audit_fingerprint_changes_when_the_audit_source_changes(monkeypatch):
    before = audit_fingerprint("qec_memory")
    monkeypatch.setattr(runner, "_fp_cache", {})
    real = runner.source_closure
    monkeypatch.setattr(runner, "source_closure", lambda name: {**real(name), "kernel.discovery.audits.qec_memory": b"edited"})
    assert audit_fingerprint("qec_memory") != before
    expected = hashlib.sha256()
    expected.update(b"audit\0qec_memory\0")
    for name, data in sorted({**real("kernel.discovery.audits.qec_memory"), "kernel.discovery.audits.qec_memory": b"edited"}.items()):
        expected.update(name.encode() + b"\0" + data + b"\0")
    assert audit_fingerprint("qec_memory") == expected.hexdigest()
