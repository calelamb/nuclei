"""Tests for kernel.qec.explain: deliberately broken circuits + minimum weight."""

from __future__ import annotations

import re

import pytest
import stim

from kernel.qec.explain import explain_nondeterministic, min_weight_logical_error

NOISE = 0.001


def _flat_lines(name: str, distance: int, rounds: int) -> list[str]:
    circuit = stim.Circuit.generated(
        name, distance=distance, rounds=rounds, after_clifford_depolarization=NOISE
    )
    return str(circuit.flattened()).split("\n")


def _detector_rows(lines: list[str]) -> list[int]:
    return [i for i, line in enumerate(lines) if line.startswith("DETECTOR")]


def _bump(line: str, delta: int) -> str:
    return re.sub(
        r"rec\[-(\d+)\]", lambda m: f"rec[-{max(1, int(m.group(1)) + delta)}]", line, count=1
    )


def _drop_last_target(line: str) -> str:
    return re.sub(r" rec\[-\d+\]$", "", line)


MUTATORS = {
    "shift_older": lambda line: _bump(line, +1),
    "shift_newer": lambda line: _bump(line, -1),
    "drop_target": _drop_last_target,
}

CODES = [
    ("surface_code:rotated_memory_z", 3, 3),
    ("surface_code:rotated_memory_x", 3, 3),
    ("surface_code:rotated_memory_z", 5, 3),
    ("repetition_code:memory", 5, 4),
    ("repetition_code:memory", 3, 5),
]


def _broken_cases() -> list[tuple[str, int, int, str]]:
    """(code, distance, nth-detector, mutation) combos Stim flags as non-deterministic."""
    cases = []
    for name, distance, rounds in CODES:
        lines = _flat_lines(name, distance, rounds)
        rows = _detector_rows(lines)
        for nth in (len(rows) // 4, len(rows) // 2, 3 * len(rows) // 4, len(rows) - 2):
            for mutation, fn in MUTATORS.items():
                broken = list(lines)
                broken[rows[nth]] = fn(lines[rows[nth]])
                if _flagged("\n".join(broken)):
                    cases.append((name, distance, rounds, f"{nth}:{mutation}"))
    return cases


def _flagged(text: str) -> bool:
    try:
        stim.Circuit(text).detector_error_model()
    except ValueError as exc:
        return "non-deterministic detectors" in str(exc)
    return False


BROKEN = _broken_cases()


def test_at_least_twenty_broken_circuits_are_generated():
    assert len(BROKEN) >= 20


@pytest.mark.parametrize("name,distance,rounds,spec", BROKEN)
def test_mutated_detector_is_identified(name, distance, rounds, spec):
    nth_text, mutation = spec.split(":")
    nth = int(nth_text)
    lines = _flat_lines(name, distance, rounds)
    rows = _detector_rows(lines)
    lines[rows[nth]] = MUTATORS[mutation](lines[rows[nth]])
    source = "\n".join(lines)

    result = explain_nondeterministic(source)

    assert result["status"] == "nondeterministic"
    assert result["detector_indices"] == [nth]
    assert result["observable_indices"] == []
    operation = result["operation"]["description"]
    assert re.search(r"reset|measurement", operation)
    gate = re.search(r"\((\w+)\)", operation).group(1)
    assert result["line_text"].split()[0] == gate
    assert result["operation"]["qubits"][0] in {
        int(t) for t in result["line_text"].split()[1:] if t.isdigit()
    }
    assert f"D{nth}" in result["sentence"]
    assert result["diagram_svg"].startswith("<svg")
    assert "even without noise" in result["sentence"]


def test_wrong_basis_measurement_names_exact_operation():
    source = "R 0\nH 0\nM 0\nDETECTOR rec[-1]\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["detector_indices"] == [0]
    assert result["operation"]["description"] == "Z-basis reset (R)"
    assert result["operation"]["qubits"] == [0]
    assert result["line"] == 1
    assert result["tick"] == 0


def test_nondeterministic_observable_is_reported_as_such():
    source = "R 0\nM 0\nOBSERVABLE_INCLUDE(0) rec[-1]\nH 0\nM 0\nOBSERVABLE_INCLUDE(1) rec[-1]\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["kind"] == "observable"
    assert result["observable_indices"] == [1]
    assert result["detector_indices"] == []
    assert "Observable L1" in result["sentence"]


def test_line_is_resolved_through_fused_lines_comments_and_blank_lines():
    source = "# header\nR 0\n\nR 1  # second\nH 0\nM 0\nM 1\nDETECTOR rec[-2]\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    # Stim fuses `R 0` + `R 1` into one instruction; the collapse is the R on qubit 0.
    assert result["operation"]["qubits"] == [0]
    assert result["line"] == 2
    assert result["line_text"] == "R 0"


def test_fused_measurement_line_uses_the_qubit_it_names():
    # The offending qubit is 1, which lives on the second of two fused source lines.
    source = "R 0\nR 1\nH 1\nM 0\nM 1\nDETECTOR rec[-1]\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["operation"]["qubits"] == [1]
    assert result["line"] == 2
    assert result["line_text"] == "R 1"


def test_line_inside_repeat_block_points_into_the_body():
    source = "R 0\nREPEAT 3 {\n    R 1\n    TICK\n    H 1\n    M 1\n    DETECTOR rec[-1]\n}\nM 0\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["line"] == 3
    assert result["line_text"] == "R 1"
    assert result["operation"]["qubits"] == [1]


def test_unflattened_generated_surface_code_mutation_maps_into_repeat_body():
    lines = str(stim.Circuit.generated("surface_code:rotated_memory_z", distance=3, rounds=4,
                                       after_clifford_depolarization=NOISE)).split("\n")
    start = next(i for i, l in enumerate(lines) if l.startswith("REPEAT"))
    rows = [i for i, l in enumerate(lines) if i > start and l.strip().startswith("DETECTOR")]
    candidate = list(lines)
    candidate[rows[0]] = _bump(lines[rows[0]], +1)
    result = explain_nondeterministic("\n".join(candidate))
    assert result["status"] == "nondeterministic"
    assert result["line"] is not None
    assert result["line_text"].split()[0] in {"R", "MR", "M", "RX", "MX", "RY", "MY"}


def test_bad_rec_offset_is_invalid_circuit_with_line():
    source = "R 0\nM 0\nDETECTOR rec[-2]\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "invalid_circuit"
    assert result["line"] == 3
    assert "rec[-2]" in result["sentence"]


def test_parse_error_reports_line():
    result = explain_nondeterministic("R 0\nFOO 1\nM 0\n")
    assert result["status"] == "parse_error"
    assert result["line"] == 2
    assert "FOO" in result["sentence"]


def test_valid_circuit_is_ok_and_does_not_claim_cause():
    result = explain_nondeterministic(str(stim.Circuit.generated(
        "surface_code:rotated_memory_z", distance=3, rounds=3)))
    assert result["status"] == "ok"
    assert "diagram_svg" not in result


@pytest.mark.parametrize("distance", [3, 5])
def test_rotated_surface_memory_min_weight_equals_distance(distance):
    text = str(stim.Circuit.generated(
        "surface_code:rotated_memory_z", distance=distance, rounds=distance,
        after_clifford_depolarization=NOISE))
    result = min_weight_logical_error(text)
    assert result["status"] == "ok"
    assert result["weight"] == distance
    assert len(result["faults"]) == distance
    assert result["num_observables"] == 1
    assert result["num_detectors"] == stim.Circuit(text).num_detectors
    assert result["weight_is_upper_bound"] is True
    source_lines = text.splitlines()
    for fault in result["faults"]:
        assert fault["located"]
        assert isinstance(fault["tick"], int)
        assert fault["qubits"]
        assert fault["gate"]
        assert source_lines[fault["line"] - 1].strip().startswith(fault["gate"])
        assert fault["observables"] or fault["detectors"]


def test_min_weight_of_noiseless_circuit_is_none_found():
    text = str(stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3))
    result = min_weight_logical_error(text)
    assert result["status"] == "none_found"
    assert result["num_observables"] == 1


def test_min_weight_without_observable_says_so():
    result = min_weight_logical_error("R 0\nX_ERROR(0.1) 0\nM 0\nDETECTOR rec[-1]\n")
    assert result["status"] == "none_found"
    assert "OBSERVABLE_INCLUDE" in result["sentence"]


def test_min_weight_on_broken_circuit_returns_the_explanation():
    result = min_weight_logical_error("R 0\nH 0\nM 0\nDETECTOR rec[-1]\n")
    assert result["status"] == "nondeterministic"


def test_min_weight_falls_back_to_bounded_search(monkeypatch):
    text = str(stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3,
                                      after_clifford_depolarization=NOISE))

    def boom(self, **_kwargs):
        raise ValueError("no graphlike error")

    monkeypatch.setattr(stim.Circuit, "shortest_graphlike_error", boom)
    result = min_weight_logical_error(text)
    assert result["status"] == "ok"
    assert result["method"] == "search_for_undetectable_logical_errors"
    assert "heuristic" in result["sentence"]


def test_min_weight_measurement_flip_fault_has_qubits():
    result = min_weight_logical_error("R 0\nM(0.1) 0\nOBSERVABLE_INCLUDE(0) rec[-1]\n")
    assert result["status"] == "ok"
    assert result["weight"] == 1
    assert result["faults"][0]["qubits"] == [0]
    assert result["faults"][0]["gate"] == "M"
    assert result["faults"][0]["line"] == 2
