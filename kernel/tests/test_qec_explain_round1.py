"""Fix round 1: start-of-circuit initialisation, mixed naming, declaration lines,
fallback caveat, ELSE_CORRELATED_ERROR, REPEAT header errors, routing."""

from __future__ import annotations

import asyncio
import json
import sys

import stim

from kernel import server
from kernel.qec.explain import (
    FALLBACK_CAVEAT,
    GRAPHLIKE_CAVEAT,
    explain_nondeterministic,
    min_weight_logical_error,
)
from kernel.qec.explain_handler import MAX_CIRCUIT_BYTES
from kernel.qec.explain_parse import first_failing_line, parse_stim_error


def _missing_reset_circuit() -> str:
    circuit = stim.Circuit.generated("surface_code:rotated_memory_x", distance=3, rounds=3)
    lines = str(circuit.flattened()).split("\n")
    first_rx = next(i for i, line in enumerate(lines) if line.startswith("RX"))
    return "\n".join(lines[:first_rx] + lines[first_rx + 1:])


def test_missing_reset_parses_operation_and_qubits():
    result = explain_nondeterministic(_missing_reset_circuit())
    assert result["status"] == "nondeterministic"
    assert "initialization" in result["operation"]["description"]
    assert result["operation"]["qubits"]
    assert result["tick"] == 0
    assert "anti-commutes with what" in result["sentence"]
    assert "initialization" in result["sentence"]


def test_missing_reset_minimal_names_start_of_circuit():
    result = explain_nondeterministic("H 0\nM 0\nDETECTOR rec[-1]\n")
    assert result["status"] == "nondeterministic"
    assert result["operation"]["qubits"] == [0]
    assert "start of the circuit" in result["operation"]["description"]
    assert result["tick"] == 0
    assert result["detector_indices"] == [0]


def test_detector_not_called_observable_when_both_are_listed():
    source = "H 0\nM 0\nDETECTOR rec[-1]\nOBSERVABLE_INCLUDE(0) rec[-1]\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["detector_indices"] == [0]
    assert result["observable_indices"] == [0]
    sentence = result["sentence"]
    assert "Observable D0" not in sentence
    assert sentence.startswith("Detector D0 and observable L0 are non-deterministic")


def test_parse_op_without_article():
    info = parse_stim_error(
        "The circuit contains non-deterministic detectors.\n\n"
        "This was discovered while analyzing qubit initialization into |0> at the start "
        "of the circuit on:\n    qubit 3\n\n"
        "The collapse anti-commuted with these detectors/observables:\n    D2\n"
    )
    assert info.operation == "qubit initialization into |0> at the start of the circuit"
    assert info.qubits == (3,)
    assert info.targets == ("D2",)


def test_declaration_line_for_detector_and_observable():
    source = "R 0\nR 1\nH 1\nM 0\nM 1\nDETECTOR rec[-2]\nDETECTOR rec[-1]\nOBSERVABLE_INCLUDE(0) rec[-1]\n"
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["declaration_lines"] == {"D1": 7, "L0": 8}


def test_declaration_line_inside_repeat_uses_body_line():
    source = (
        "R 0\nM 0\nREPEAT 3 {\n    R 1\n    H 1\n    M 1\n    DETECTOR rec[-1]\n}\n"
    )
    result = explain_nondeterministic(source)
    assert result["status"] == "nondeterministic"
    assert result["declaration_lines"][result["targets"][0]] == 7


def test_fallback_uses_its_own_caveat(monkeypatch):
    text = str(stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3,
                                      after_clifford_depolarization=0.001))
    monkeypatch.setattr(stim.Circuit, "shortest_graphlike_error",
                        lambda self, **_k: (_ for _ in ()).throw(ValueError("x")))
    result = min_weight_logical_error(text)
    assert result["caveat"] == FALLBACK_CAVEAT
    assert "graphlike" not in result["caveat"].lower().replace("not restricted to graphlike", "")
    assert GRAPHLIKE_CAVEAT not in result["sentence"]


def test_primary_path_keeps_graphlike_caveat():
    text = str(stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3,
                                      after_clifford_depolarization=0.001))
    assert min_weight_logical_error(text)["caveat"] == GRAPHLIKE_CAVEAT


ELSE_CIRCUIT = (
    "R 0 1\nCORRELATED_ERROR(0.1) X0\nELSE_CORRELATED_ERROR(0.1) X1\n"
    "M 0 1\nDETECTOR rec[-2]\nOBSERVABLE_INCLUDE(0) rec[-1]\n"
)


def test_else_correlated_error_is_not_reported_invalid():
    assert explain_nondeterministic(ELSE_CIRCUIT)["status"] == "ok"
    assert min_weight_logical_error(ELSE_CIRCUIT)["status"] == "ok"


def test_else_correlated_error_still_detects_real_nondeterminism():
    broken = ELSE_CIRCUIT.replace("R 0 1", "R 0 1\nH 0")
    assert explain_nondeterministic(broken)["status"] == "nondeterministic"


def test_first_failing_line_flags_bad_repeat_headers():
    assert first_failing_line("R 0\nREPEAT x {\nH 0\n}\n") == 2
    assert first_failing_line("R 0\nREPEAT 0 {\nH 0\n}\n") == 2
    assert first_failing_line("R 0\nREPEAT 3 {\nH 0\n}\n") is None
    result = explain_nondeterministic("R 0\nREPEAT x {\nH 0\n}\n")
    assert result["status"] == "parse_error"
    assert result["line"] == 2


# ---- routing through handle_message -------------------------------------


class _Socket:
    def __init__(self, requests: list[dict]) -> None:
        self._requests = [json.dumps(r) for r in requests]
        self.sent: list[dict] = []

    def __aiter__(self):
        self._it = iter(self._requests)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))


def _replay(requests: list[dict]) -> list[dict]:
    socket = _Socket(requests)
    asyncio.run(server.handle_message(socket))
    return socket.sent


def test_routing_through_handle_message():
    sent = _replay([{"type": "qec_explain", "request_id": "a",
                     "circuit_text": "H 0\nM 0\nDETECTOR rec[-1]\n"}])
    assert sent[-1]["type"] == "qec_explain_result"
    assert sent[-1]["request_id"] == "a"


def test_missing_stim_is_a_visible_error_and_connection_survives(monkeypatch):
    for name in [m for m in sys.modules if m.startswith("kernel.qec.explain")
                 and m != "kernel.qec.explain_handler"]:
        monkeypatch.delitem(sys.modules, name)
    monkeypatch.setitem(sys.modules, "stim", None)
    sent = _replay([
        {"type": "qec_explain", "request_id": "m", "circuit_text": "R 0\nM 0\n"},
        {"type": "qec_explain", "request_id": "n", "circuit_text": ""},
    ])
    assert [m["request_id"] for m in sent] == ["m", "n"]
    assert sent[0]["type"] == "error"
    assert sent[0]["code"] == "missing_dependency"
    assert sent[0]["phase"] == "qec_explain"
    assert sent[1]["code"] == "qec_explain_invalid"


def test_circuit_cap_fits_under_websocket_limit():
    assert MAX_CIRCUIT_BYTES < server.MAX_MESSAGE_SIZE
