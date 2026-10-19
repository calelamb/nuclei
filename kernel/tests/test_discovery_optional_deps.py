"""PRD 14 without the optional research packages (stim, pymatching, sinter, pyarrow, duckdb, jsonschema).

The packaged app's managed venv installs only ``kernel/requirements.txt``; those packages arrive through
the in-app Research catalog. Discovery and Trainability must work without them and degrade to friendly
``missing_dependency`` errors where Stim is genuinely required (the ``qec_memory`` evaluator and its audit).

Most tests drive a subprocess that makes the packages un-importable (see ``_optional_blocker``), so they
mean the same thing in a full dev venv and in the CI job that really lacks the packages. This module must
NOT use ``pytest.importorskip`` on any optional package.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

pytest.importorskip("qiskit")

from kernel.discovery import _optional  # noqa: E402
from kernel.discovery.evaluators import EVALUATORS, availability, describe, fingerprint  # noqa: E402
from kernel.discovery.evaluators import base  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NON_QEC = ("state_synthesis", "vqe_ground_state", "trainability_frontier")
WIRE_FIELDS = {
    "kind", "version", "title", "description", "task", "entry_signature", "objectives", "descriptors",
    "config_schema", "default_config", "stages",
}
ANALYSES = ("gradients", "scaling", "lie", "expressibility", "entanglement", "landscape")


@pytest.fixture(scope="module")
def scenario() -> dict:
    """Run every PRD 14 entry point once in a subprocess where the optional packages cannot be imported."""
    proc = subprocess.run(
        [sys.executable, "-m", "kernel.tests._optional_deps_scenario"],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=900,
    )
    assert proc.returncode == 0, f"scenario crashed:\n{proc.stderr[-3000:]}"
    line = [ln for ln in proc.stdout.splitlines() if ln.startswith("RESULT:")]
    assert line, f"no RESULT line:\n{proc.stdout[-1500:]}\n{proc.stderr[-1500:]}"
    return json.loads(line[-1][len("RESULT:"):])


# --- the blocker itself ------------------------------------------------------------------------


def test_blocker_really_hides_every_optional_package(scenario):
    assert set(scenario["blocked_import_raises"]) == {"stim", "pymatching", "sinter", "jsonschema", "pyarrow", "duckdb"}


# --- discovery_evaluators --------------------------------------------------------------------


def test_evaluators_lists_all_with_qec_memory_flagged_unavailable(scenario):
    listing = {e["kind"]: e for e in scenario["evaluators"]["evaluators"]}
    assert set(listing) == {"qec_memory", *NON_QEC}
    qec = listing["qec_memory"]
    assert qec["available"] is False
    assert qec["missing"] == ["stim", "pymatching"]
    assert qec["install"]["catalog_ids"] == ["stim", "pymatching"]
    assert "Research catalog" in qec["install"]["hint"]
    assert WIRE_FIELDS <= set(qec)  # existing fields unchanged, the new ones are additive


@pytest.mark.parametrize("kind", NON_QEC)
def test_evaluators_that_need_no_stim_stay_available(scenario, kind):
    entry = {e["kind"]: e for e in scenario["evaluators"]["evaluators"]}[kind]
    assert entry["available"] is True
    assert "missing" not in entry and "install" not in entry
    assert WIRE_FIELDS <= set(entry)


# --- discovery_evaluate ------------------------------------------------------------------------


def test_evaluate_qec_memory_is_a_missing_dependency_error(scenario):
    reply = scenario["evaluate"]["qec_memory"]
    assert reply["type"] == "error" and reply["phase"] == "discovery"
    assert reply["code"] == "missing_dependency"
    assert reply["missing"] == ["stim", "pymatching"]
    assert "stim" in reply["message"] and "Research catalog" in reply["message"]
    assert reply["install"]["catalog_ids"] == ["stim", "pymatching"]
    assert reply["run_id"] == "r" and reply["candidate_id"] == "c0"


@pytest.mark.parametrize("kind", NON_QEC)
def test_evaluate_without_stim_scores_the_other_evaluators(scenario, kind):
    reply = scenario["evaluate"][kind]
    assert reply["type"] == "discovery_evaluation", reply
    assert reply["evaluation"]["status"] == "scored", reply["evaluation"]


def test_other_discovery_requests_do_not_need_stim(scenario):
    assert scenario["mutate"]["type"] == "discovery_mutations" and len(scenario["mutate"]["mutations"]) == 2
    assert scenario["program_key"]["type"] == "discovery_program_key_result"
    assert scenario["conjecture_schema"]["type"] == "discovery_conjecture_schema_result"


# --- audits and conjectures --------------------------------------------------------------------


def test_qec_audit_degrades_to_missing_dependency(scenario):
    reply = scenario["audit"]["qec_memory"]
    assert reply["type"] == "error" and reply["code"] == "missing_dependency" and reply["phase"] == "discovery"
    assert reply["missing"] == ["stim", "pymatching"]


def test_state_synthesis_audit_runs_without_stim(scenario):
    reply = scenario["audit"]["state_synthesis"]
    assert reply["type"] == "discovery_audit_result", reply
    assert reply["audit"]["verdict"] in {"consistent", "exploit", "inconclusive"}


def test_conjectures_need_only_numpy_and_qiskit(scenario):
    reply = scenario["conjecture_test"]
    assert reply["type"] == "discovery_conjecture_result" and reply["status"] == "complete", reply
    assert reply["result"]["verdict"] in {"supported", "refuted", "inconclusive"}


# --- config validation ---------------------------------------------------------------------------


def test_config_validation_uses_the_hand_written_fallback(scenario):
    assert scenario["jsonschema_absent"] is True
    for kind, problem in scenario["config_validation"].items():
        assert problem is not None and "unknown option" in problem, (kind, problem)
    bad = scenario["evaluate_bad_config"]
    assert bad["type"] == "error" and bad["code"] == "invalid_config", bad
    assert "n_qubits" in bad["message"]


# --- trainability -----------------------------------------------------------------------------------


def test_trainability_inspect_and_lint(scenario):
    assert scenario["inspect"]["type"] == "trainability_inspected" and scenario["inspect"]["n_qubits"] == 3
    lint = scenario["lint"]
    assert lint["type"] == "trainability_lint_result" and isinstance(lint["diagnostics"], list)


@pytest.mark.parametrize("method", ["auto", "ppe"])
def test_trainability_job_runs_every_analysis(scenario, method):
    job = scenario["trainability_jobs"][method]
    assert job["type"] == "trainability_result" and job["status"] == "complete", job
    assert not job["errors"]
    for name in ANALYSES:
        assert job["results"][name], name


def test_ppe_falls_back_to_native_clifford_conjugation(scenario):
    assert scenario["symplectic"] == {
        "stim_attr": True, "auto_backend": "native", "forced_stim_error": "use_stim=True but stim is not installed",
    }


# --- in-process: availability bookkeeping ---------------------------------------------------------------


@pytest.fixture
def no_stim(monkeypatch):
    """``import stim`` raises ImportError for this test (works whether or not stim is installed)."""
    monkeypatch.setitem(sys.modules, "stim", None)
    monkeypatch.setitem(sys.modules, "pymatching", None)


def test_describe_marks_qec_memory_unavailable_and_keeps_wire_fields(no_stim):
    payload = describe(EVALUATORS["qec_memory"])
    assert payload["available"] is False and payload["missing"] == ["stim", "pymatching"]
    assert payload["install"]["catalog_ids"] == ["stim", "pymatching"]
    assert WIRE_FIELDS <= set(payload)
    json.dumps(payload)
    ok = describe(EVALUATORS["state_synthesis"])
    assert ok["available"] is True and "missing" not in ok


def test_only_pymatching_missing_names_only_that_catalog_entry(monkeypatch):
    monkeypatch.setitem(sys.modules, "pymatching", None)
    monkeypatch.setattr(availability, "missing_modules", lambda names: [n for n in names if n == "pymatching"])
    payload = describe(EVALUATORS["qec_memory"])
    assert payload["missing"] == ["pymatching"] and payload["install"]["catalog_ids"] == ["pymatching"]


def test_catalog_ids_match_frameworks_rs():
    source = open(os.path.join(REPO_ROOT, "src-tauri", "src", "commands", "frameworks.rs"), encoding="utf-8").read()
    for catalog_id in set(_optional.CATALOG_IDS.values()):
        assert f'id: "{catalog_id}"' in source, catalog_id


def test_lazy_module_defers_the_import_error(no_stim):
    proxy = _optional.lazy_module("stim")  # creating it never imports
    with pytest.raises(_optional.MissingDependency) as info:
        proxy.Circuit  # noqa: B018 - attribute access performs the import
    assert info.value.missing == ["stim"] and isinstance(info.value, ImportError)


def test_isolation_probe_does_not_depend_on_stim(no_stim):
    from kernel.discovery import isolation

    request = isolation.probe_request()
    assert request["task"] == "quantum_circuit" and "stim" not in request["program"]


def test_score_worker_refuses_a_qec_job_without_stim(no_stim):
    from kernel.discovery import score_worker

    result = score_worker.evaluate({
        "evaluator": {"kind": "qec_memory", "config": {}}, "stage": "full", "seed": 1, "artifacts": [],
    })
    assert result["status"] == "failed" and result["failure"]["code"] == "missing_dependency"


# --- in-process: fingerprints ---------------------------------------------------------------------------


@pytest.mark.parametrize("kind", NON_QEC)
def test_non_qec_fingerprints_do_not_depend_on_the_optional_dependency_plumbing(kind):
    """Their source closure excludes the files touched by this change, so their fingerprints are unchanged."""
    closure = set(base.source_closure(EVALUATORS[kind].score.__module__))
    assert not closure & {
        "kernel.discovery._optional", "kernel.discovery.noise", "kernel.discovery.evaluators.qec_guardrails",
        "kernel.discovery.evaluators.availability",
    }
    assert len(fingerprint(kind, EVALUATORS[kind].default_config)) == 64


# --- in-process: the hand validator agrees with jsonschema ---------------------------------------------------


BAD_CONFIGS = {
    "state_synthesis": [
        {"target": {"kind": "ghz", "n_qubits": "three"}}, {"target": {"kind": "nope", "n_qubits": 3}},
        {"target": {"kind": "ghz", "n_qubits": 3}, "bogus": 1}, {"optimize_parameters": {"restarts": -1}},
        {"target": "ghz"},
    ],
    "vqe_ground_state": [
        {"hamiltonian": {"n_qubits": "four"}}, {"training": {"steps": 0}}, {"unknown": True}, {"hamiltonian": 3},
    ],
    "qec_memory": [{"distances": "three"}, {"shots": {"min": -5}}, {"distances": []}, {"mystery": 1}],
    "trainability_frontier": [{"unknown": 1}, {"scaling": 5}],
}


@pytest.mark.parametrize("kind", sorted(BAD_CONFIGS))
def test_hand_validator_rejects_what_jsonschema_rejects(kind):
    jsonschema = pytest.importorskip("jsonschema")  # parity needs both validators; the subprocess test needs neither
    del jsonschema
    spec = EVALUATORS[kind]
    for override in BAD_CONFIGS[kind]:
        merged = base.deep_merge(spec.default_config, override)
        outcomes = []
        for use_jsonschema in (True, False):
            try:
                base.validate_schema(spec.config_schema, merged, use_jsonschema=use_jsonschema)
                outcomes.append("ok")
            except base.InvalidConfig:
                outcomes.append("invalid")
        assert outcomes[0] == outcomes[1], (kind, override, outcomes)


@pytest.mark.parametrize("kind", sorted(EVALUATORS))
def test_hand_validator_accepts_every_default_config(kind):
    spec = EVALUATORS[kind]
    base.validate_by_hand(spec.config_schema, base.deep_merge(spec.default_config, {}))
