"""Explain names the real cause of basis non-determinism and lists every detector."""

from __future__ import annotations

import stim

from kernel.qec.explain import MAX_LISTED_TARGETS, explain_nondeterministic

RESET_THEN_MX = "R 0 1\nM 0\nMX 1\nDETECTOR rec[-1]\nDETECTOR rec[-2]\n"
R_MX_M = "R 0\nMX 0\nM 0\nDETECTOR rec[-1]\nDETECTOR rec[-2]\nDETECTOR rec[-1] rec[-2]\n"


def _wrong_basis_surface_code() -> str:
    circuit = stim.Circuit.generated("surface_code:rotated_memory_z", distance=3, rounds=3)
    lines = str(circuit).split("\n")
    first_reset = next(i for i, ln in enumerate(lines) if ln.startswith("R "))
    lines[first_reset] = "RX " + lines[first_reset][2:]
    return "\n".join(lines)


def test_reset_blamed_by_stim_is_reframed_as_basis_mismatch():
    result = explain_nondeterministic(RESET_THEN_MX)
    cause = result["cause"]
    assert cause["kind"] == "preparation_basis_mismatch"
    assert cause["basis"] == "Z"
    assert cause["preparation_line"] == 1
    assert cause["detector_lines"] == {"D0": 4}
    sentence = result["sentence"]
    assert "not fixed by the preparation" in sentence
    assert "line 4" in sentence and "line 1" in sentence
    assert "DETECTOR" in sentence
    assert "reset is the error" not in sentence
    assert "anti-commutes with what" not in sentence


def test_generated_surface_code_wrong_basis_reset_points_at_detector_and_reset():
    source = _wrong_basis_surface_code()
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    cause = result["cause"]
    assert cause["kind"] == "preparation_basis_mismatch"
    assert cause["basis"] == "X"
    lines = source.split("\n")
    assert lines[cause["preparation_line"] - 1].startswith("RX ")
    (target, decl_line), = cause["detector_lines"].items()
    assert lines[decl_line - 1].strip().startswith("DETECTOR")
    assert target in result["sentence"]


def test_measurement_in_wrong_basis_finds_preceding_preparation():
    result = explain_nondeterministic(R_MX_M)
    cause = result["cause"]
    assert cause["kind"] == "measurement_basis_mismatch"
    assert cause["basis"] == "X"
    assert cause["preparation_line"] == 1
    assert "not fixed" in result["sentence"]


def test_non_basis_failures_have_no_cause():
    result = explain_nondeterministic("H 0\nM 0\nDETECTOR rec[-1]\n")
    assert result["status"] == "nondeterministic"
    assert result["cause"] is None or result["cause"]["kind"] == "measurement_basis_mismatch"


def test_all_listed_detectors_are_reported_with_their_own_sensitivity():
    result = explain_nondeterministic(R_MX_M)
    assert result["targets"] == ["D0", "D2"]
    assert result["target_count"] == 2
    assert result["targets_omitted"] == 0
    assert {s["target"]: s["pauli"] for s in result["sensitivities"]} == {"D0": "Z0", "D2": "Y0"}
    assert result["sensitivity"] == "Z0"
    assert "D0" in result["sentence"] and "D2" in result["sentence"]


def test_many_detectors_are_bounded_with_an_and_n_more_count():
    source = "R 0\nMX 0\n" + "DETECTOR rec[-1]\n" * (MAX_LISTED_TARGETS + 10)
    result = explain_nondeterministic(source)
    assert result["target_count"] == MAX_LISTED_TARGETS + 10
    assert len(result["targets"]) == MAX_LISTED_TARGETS
    assert len(result["sensitivities"]) <= MAX_LISTED_TARGETS
    assert result["targets_omitted"] == 10
    assert "and 10 more" in result["sentence"]
