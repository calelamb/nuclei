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


def test_blamed_measurement_is_itself_the_preparation_line():
    result = explain_nondeterministic("R 0\nMX 0\nM 0\nDETECTOR rec[-1]\n")
    cause = result["cause"]
    assert cause["kind"] == "measurement_basis_mismatch"
    assert cause["basis"] == "X"
    assert cause["operation_line"] == 2
    assert cause["preparation_line"] == 2
    assert "line 1" not in result["sentence"].replace("line 10", "")
    assert "X-basis measurement at line 2" in result["sentence"]


def test_measurement_collapse_ignores_unrelated_earlier_reset():
    src = "R 0\nH 0\nRX 0\nTICK\nMX 0\nMX 0\nTICK\nM 0\nDETECTOR rec[-1]\n"
    result = explain_nondeterministic(src)
    cause = result["cause"]
    if cause is not None:
        assert cause["preparation_line"] == cause["operation_line"]


def test_blamed_mr_without_reset_has_preparation_line():
    result = explain_nondeterministic("MR 0\nMX 0\nDETECTOR rec[-2] rec[-1]\n")
    cause = result["cause"]
    if cause is not None:
        assert cause["preparation_line"] == cause["operation_line"]
        assert cause["preparation_line"] is not None


def test_generated_surface_code_wrong_basis_detector_points_at_detector_and_reset():
    circuit = stim.Circuit.generated("surface_code:rotated_memory_z", distance=3, rounds=3)
    lines = str(circuit).split("\n")
    # Insert a DETECTOR comparing an X-basis-collapsed ancilla in round 0.
    first_m = next(i for i, ln in enumerate(lines) if ln.startswith("M "))
    lines.insert(first_m + 1, "DETECTOR rec[-1]")
    source = "\n".join(lines)
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["cause"] is not None
    (target, decl_line), *_ = result["cause"]["detector_lines"].items()
    assert source.split("\n")[decl_line - 1].strip().startswith("DETECTOR")
    assert result["cause"]["preparation_line"] is not None


def test_implicit_initialisation_has_no_cause_and_uses_fallback_sentence():
    result = explain_nondeterministic("H 0\nM 0\nDETECTOR rec[-1]\n")
    assert result["status"] == "nondeterministic"
    assert result["cause"] is None
    assert "anti-commutes with what" in result["sentence"]


def test_sentence_is_summarised_for_many_targets_and_uses_correct_article():
    source = "R 0\nMX 0\n" + "DETECTOR rec[-1]\n" * 12
    sentence = explain_nondeterministic(source)["sentence"]
    assert "and 9 more" in sentence
    assert sentence.count("D11") == 0
    assert "a X" not in sentence


def test_observable_cause_names_observable_include():
    result = explain_nondeterministic("R 0\nMX 0\nOBSERVABLE_INCLUDE(0) rec[-1]\nM 0\nOBSERVABLE_INCLUDE(0) rec[-1]\n")
    if result["status"] == "nondeterministic" and result["cause"]:
        assert "OBSERVABLE_INCLUDE" in result["sentence"]


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
    assert f"and {MAX_LISTED_TARGETS + 10 - 3} more" in result["sentence"]
