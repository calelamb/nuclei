"""Pure helpers of the corpus runner: no kernel is started here."""

from __future__ import annotations

from typing import Any

import pytest

from kernel.tests.research_corpus._support import require_yaml

require_yaml()

from kernel.tests.research_corpus import loader, runner  # noqa: E402


def make_case(**overrides: Any) -> loader.Case:
    fields: dict[str, Any] = dict(
        unit="u", id="p", env="full", language="python", code="pass\n", project_dir=None,
        parse="ok", execute="ok", healthy_after=True, max_seconds=None, max_frame_bytes=None,
        options={}, facts={}, xfail=None,
    )
    fields.update(overrides)
    return loader.Case(**fields)


def observed(**overrides: Any) -> runner.Observation:
    fields: dict[str, Any] = dict(parse="ok", execute="ok", healthy_after=True, execute_seconds=0.1, max_frame_bytes=100)
    fields.update(overrides)
    return runner.Observation(**fields)


# -- frames -> status ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("frames", "status"),
    [
        ([{"type": "snapshot"}], "ok"),
        ([{"type": "snapshot"}, {"type": "error", "code": "no_circuit"}], "error:no_circuit"),
        ([{"type": "error"}], "error"),
        ([{"type": "output"}, {"type": "__timeout__"}], "timeout"),
        ([{"type": "__closed__", "code": 1009}], "closed"),
        # a kernel-reported error wins over the harness's own bookkeeping frame
        ([{"type": "error", "code": "timeout"}, {"type": "__timeout__"}], "error:timeout"),
    ],
)
def test_classify(frames: list[dict[str, Any]], status: str) -> None:
    assert runner.classify(frames) == status


def test_snapshot_and_result_facts_summarise_the_frames() -> None:
    snap = [{"type": "snapshot", "data": {"framework": "qiskit", "qubit_count": 2, "depth": 3, "gates": [1, 2, 3, 4]}}]
    assert runner.snapshot_facts(snap) == {"framework": "qiskit", "qubit_count": 2, "depth": 3, "gates": 4}
    result = [
        {
            "type": "result",
            "data": {
                "probabilities": {"00": 0.5, "11": 0.5}, "measurements": {"00": 500, "11": 524},
                "bloch_coords": [1, 2], "state_vector": [1, 2, 3, 4], "metrics": {"m": 1.5}, "seed_honored": True,
            },
        }
    ]
    assert runner.result_facts(result) == {
        "probabilities": 2, "measured": 1024, "bloch": 2, "state_vector": 4, "metrics": {"m": 1.5}, "seed_honored": True,
    }
    assert runner.snapshot_facts([{"type": "snapshot", "data": None}]) is None
    assert runner.result_facts([]) is None


def test_facts_mismatches_is_a_subset_match_with_float_tolerance() -> None:
    assert runner.facts_mismatches({"result": {"measured": 1024}}, {"result": {"measured": 1024, "bloch": 2}}) == []
    assert runner.facts_mismatches({"result": {"metrics": {"t": 1.1}}}, {"result": {"metrics": {"t": 1.1 + 1e-13}}}) == []
    problems = runner.facts_mismatches({"result": {"measured": 1024}}, {"result": {"measured": 1000}})
    assert problems == ["facts.result.measured: expected 1024, observed 1000"]
    assert "phase produced none" in runner.facts_mismatches({"snapshot": {"depth": 1}}, {})[0]


# -- compare / drift ------------------------------------------------------------------


def test_compare_accepts_a_match_and_names_each_difference() -> None:
    assert runner.compare(make_case(), observed()) == []
    problems = runner.compare(
        make_case(max_seconds=1, max_frame_bytes=50),
        observed(execute="error:simulation_error", healthy_after=False, execute_seconds=2.0),
    )
    joined = " | ".join(problems)
    assert "execute: expected 'ok', observed 'error:simulation_error'" in joined
    assert "healthy_after: expected True, observed False" in joined
    assert "execute took 2.00s, limit 1s" in joined
    assert "largest frame 100 bytes, limit 50" in joined


def test_compare_only_checks_the_driven_phases() -> None:
    case = make_case(options={"phases": ["execute"]}, parse="ok")
    assert runner.compare(case, observed(parse=None)) == []


def test_compare_checks_facts_only_when_statuses_match() -> None:
    case = make_case(facts={"result": {"measured": 1024}})
    assert runner.compare(case, observed(facts={"result": {"measured": 5}})) == [
        "facts.result.measured: expected 1024, observed 5"
    ]
    assert len(runner.compare(case, observed(execute="timeout", facts={"result": {"measured": 5}}))) == 1


def test_drift_flags_a_known_bug_that_changed_shape() -> None:
    xfail = loader.Xfail(("R-1",), "why", {"execute": "error:simulation_error", "max_frame_bytes": 9})
    case = make_case(xfail=xfail)
    assert runner.drift(case, observed(execute="error:simulation_error")) == []
    assert runner.drift(case, observed(execute="timeout")) == [
        "execute: ledger says 'error:simulation_error', observed 'timeout'"
    ]
    unhealthy = make_case(xfail=loader.Xfail(("R-6",), "why", {"healthy_after": False}))
    assert runner.drift(unhealthy, observed(healthy_after=True)) == ["healthy_after: ledger says False, observed True"]
    assert runner.drift(make_case(), observed(execute="timeout")) == []


# -- env probe ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("env", "facts", "clean"),
    [
        ("min", {"qiskit": "1.4.6", "qdk": None, "stim": None}, True),
        ("full", {"qiskit": "1.4.6", "qdk": "1.33", "stim": "1.16"}, True),
        ("qk2", {"qiskit": "2.6.0", "qdk": "1.33", "stim": None}, True),
        ("min", {"qiskit": "1.4.6", "qdk": "1.33", "stim": None}, False),
        ("full", {"qiskit": "2.6.0", "qdk": "1.33", "stim": "1.16"}, False),
        ("qk2", {"qiskit": "2.6.0", "qdk": "1.33", "stim": "1.16"}, False),
        ("qk2", {"qiskit": None, "qdk": "1.33", "stim": None}, False),
    ],
)
def test_env_problems(env: str, facts: dict[str, str | None], clean: bool) -> None:
    assert (runner.env_problems(env, facts) == []) is clean


def test_probe_env_reads_the_running_interpreter() -> None:
    import sys

    facts = runner.probe_env(sys.executable)
    assert set(facts) == {"qiskit", "qdk", "stim"}


# -- project programs ---------------------------------------------------------------------


def test_project_token_is_replaced_in_nested_request_values() -> None:
    case = make_case(
        options={"request": {"project_root": "$PROJECT", "nested": {"paths": ["$PROJECT/a", "keep"]}}, "seed": 3, "params": {"t": 1}},
    )
    parse, execute = runner._messages(case, "/tmp/p")
    assert parse["project_root"] == "/tmp/p" and parse["type"] == "parse" and "seed" not in parse
    assert execute["nested"] == {"paths": ["/tmp/p/a", "keep"]}
    assert (execute["type"], execute["shots"], execute["seed"], execute["params"]) == ("execute", 1024, 3, {"t": 1})
    assert parse["language"] == "python" and execute["code"] == "pass\n"
