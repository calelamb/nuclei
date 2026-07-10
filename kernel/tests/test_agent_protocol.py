import json
from dataclasses import FrozenInstanceError

import pytest

from kernel.agent_protocol import (
    MAX_CODE_BYTES,
    MAX_REQUEST_BYTES,
    MAX_SHOTS,
    PROTOCOL_VERSION,
    AgentRequest,
    ProtocolError,
    parse_request,
    response_bytes,
)


def request_bytes(**changes: object) -> bytes:
    value = {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "r-1",
        "action": "simulate",
        "framework": "cirq",
        "language": "python",
        "code": "import cirq\ncircuit = cirq.Circuit()",
        "shots": 128,
    }
    value.update(changes)
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def test_accepts_valid_cirq_simulate_request() -> None:
    parsed = parse_request(request_bytes())

    assert parsed == AgentRequest(
        request_id="r-1",
        action="simulate",
        framework="cirq",
        language="python",
        code="import cirq\ncircuit = cirq.Circuit()",
        shots=128,
    )


def test_accepts_parse_without_shots() -> None:
    value = json.loads(request_bytes(action="parse"))
    del value["shots"]

    parsed = parse_request(json.dumps(value).encode("utf-8"))

    assert parsed.action == "parse"
    assert parsed.shots is None


@pytest.mark.parametrize(
    ("framework", "language", "shots"),
    [
        ("qiskit", "python", 1),
        ("qsharp", "qsharp", MAX_SHOTS),
    ],
)
def test_accepts_admitted_framework_and_shot_endpoints(
    framework: str, language: str, shots: int
) -> None:
    parsed = parse_request(
        request_bytes(framework=framework, language=language, shots=shots)
    )

    assert (parsed.framework, parsed.language, parsed.shots) == (
        framework,
        language,
        shots,
    )


def test_accepts_64_character_request_id() -> None:
    parsed = parse_request(request_bytes(request_id="a" * 64))

    assert parsed.request_id == "a" * 64


def test_accepts_request_at_exact_byte_limit() -> None:
    value = json.loads(request_bytes(action="parse"))
    del value["shots"]
    raw = json.dumps(value).encode("utf-8")
    raw += b" " * (MAX_REQUEST_BYTES - len(raw))

    assert len(raw) == MAX_REQUEST_BYTES
    assert parse_request(raw).action == "parse"


def test_rejects_duplicate_json_object_keys() -> None:
    raw = b'{"protocol_version":1,' + request_bytes()[1:]

    with pytest.raises(ProtocolError):
        parse_request(raw)


@pytest.mark.parametrize("encoding", ["utf-16", "utf-32"])
def test_rejects_non_utf8_json_bytes(encoding: str) -> None:
    raw = request_bytes().decode("utf-8").encode(encoding)

    with pytest.raises(ProtocolError, match="^malformed_json$"):
        parse_request(raw)


def test_translates_deep_json_recursion_to_protocol_error() -> None:
    raw = b"[" * 100_000 + b"]" * 100_000

    with pytest.raises(ProtocolError, match="^malformed_json$"):
        parse_request(raw)


@pytest.mark.parametrize(
    ("name", "raw", "error"),
    [
        ("malformed JSON", b"{not-json", "malformed_json"),
        ("invalid UTF-8", b'{"code":"\xff"}', "malformed_json"),
        ("non-object", b"[]", "request_must_be_object"),
        ("unknown field", request_bytes(extra=True), "unknown_field"),
        (
            "missing field",
            json.dumps(
                {
                    "protocol_version": 1,
                    "request_id": "r-1",
                    "action": "parse",
                    "framework": "cirq",
                    "language": "python",
                }
            ).encode(),
            "missing_field",
        ),
        ("unsupported version", request_bytes(protocol_version=2), "unsupported_version"),
        ("boolean version", request_bytes(protocol_version=True), "unsupported_version"),
        ("empty id", request_bytes(request_id=""), "invalid_request_id"),
        ("long id", request_bytes(request_id="a" * 65), "invalid_request_id"),
        ("punctuated id", request_bytes(request_id="r.1"), "invalid_request_id"),
        ("non-string id", request_bytes(request_id=1), "invalid_request_id"),
        ("invalid action", request_bytes(action="execute"), "invalid_action"),
        ("non-string action", request_bytes(action=None), "invalid_action"),
        ("CUDA-Q unavailable", request_bytes(framework="cuda-q"), "framework_unavailable"),
        ("unknown framework", request_bytes(framework="braket"), "framework_unavailable"),
        (
            "Q# with Python",
            request_bytes(framework="qsharp", language="python"),
            "framework_language_mismatch",
        ),
        (
            "Cirq with Q#",
            request_bytes(framework="cirq", language="qsharp"),
            "framework_language_mismatch",
        ),
        ("non-string code", request_bytes(code=None), "invalid_code"),
        ("parse with shots", request_bytes(action="parse", shots=1), "parse_forbids_shots"),
        ("parse with null shots", request_bytes(action="parse", shots=None), "parse_forbids_shots"),
        ("simulate without shots", request_bytes(shots=None), "invalid_shots"),
        ("zero shots", request_bytes(shots=0), "invalid_shots"),
        ("too many shots", request_bytes(shots=MAX_SHOTS + 1), "invalid_shots"),
        ("boolean shots", request_bytes(shots=True), "invalid_shots"),
        ("fractional shots", request_bytes(shots=1.5), "invalid_shots"),
    ],
)
def test_rejects_invalid_request_matrix(name: str, raw: bytes, error: str) -> None:
    with pytest.raises(ProtocolError, match=f"^{error}$"):
        parse_request(raw)


def test_enforces_request_byte_limit() -> None:
    with pytest.raises(ProtocolError, match="^request_too_large$"):
        parse_request(b" " * (MAX_REQUEST_BYTES + 1))


def test_enforces_256_kib_utf8_code_boundary() -> None:
    parse_request(request_bytes(code="é" * (MAX_CODE_BYTES // 2)))

    with pytest.raises(ProtocolError, match="^code_too_large$"):
        parse_request(request_bytes(code="é" * (MAX_CODE_BYTES // 2 + 1)))


def test_agent_request_is_frozen() -> None:
    parsed = parse_request(request_bytes())

    with pytest.raises(FrozenInstanceError):
        parsed.shots = 256  # type: ignore[misc]


def test_response_is_exactly_one_compact_utf8_json_line() -> None:
    raw = response_bytes("réq-1", "ok", None, None, "é", "", None)

    assert raw == (
        b'{"protocol_version":1,"request_id":"r\\u00e9q-1","status":"ok",'
        b'"snapshot":null,"result":null,"stdout":"\\u00e9","stderr":"","error":null}\n'
    )
    assert raw.count(b"\n") == 1
    assert json.loads(raw)["protocol_version"] == PROTOCOL_VERSION


def test_response_rejects_non_finite_numbers() -> None:
    with pytest.raises(ValueError):
        response_bytes("r-1", "ok", None, {"value": float("nan")}, "", "", None)


def transpile_request_bytes(**changes: object) -> bytes:
    value = {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "r-1",
        "action": "transpile",
        "framework": "qiskit",
        "language": "python",
        "code": "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)",
    }
    value.update(changes)
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def test_accepts_minimal_transpile_request() -> None:
    parsed = parse_request(transpile_request_bytes())

    assert parsed == AgentRequest(
        request_id="r-1",
        action="transpile",
        framework="qiskit",
        language="python",
        code="from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)",
        shots=None,
        basis_gates=None,
        coupling_map=None,
        optimization_level=None,
    )


def test_accepts_transpile_request_with_all_optional_fields() -> None:
    parsed = parse_request(
        transpile_request_bytes(
            basis_gates=["u", "cx"],
            coupling_map=[[0, 1], [1, 0]],
            optimization_level=3,
        )
    )

    assert parsed.basis_gates == ["u", "cx"]
    assert parsed.coupling_map == [[0, 1], [1, 0]]
    assert parsed.optimization_level == 3


def test_accepts_transpile_request_with_explicit_null_optional_fields() -> None:
    parsed = parse_request(
        transpile_request_bytes(basis_gates=None, coupling_map=None, optimization_level=None)
    )

    assert parsed.basis_gates is None
    assert parsed.coupling_map is None
    assert parsed.optimization_level is None


@pytest.mark.parametrize(
    ("name", "changes", "error"),
    [
        ("non-qiskit framework", {"framework": "cirq", "language": "python"}, "transpile_requires_qiskit"),
        ("shots present", {"shots": 128}, "transpile_forbids_shots"),
        ("non-list basis_gates", {"basis_gates": "u"}, "invalid_basis_gates"),
        ("non-string basis_gates entries", {"basis_gates": [1, 2]}, "invalid_basis_gates"),
        ("non-list coupling_map", {"coupling_map": "bad"}, "invalid_coupling_map"),
        ("coupling_map pair wrong length", {"coupling_map": [[0, 1, 2]]}, "invalid_coupling_map"),
        ("coupling_map non-int entries", {"coupling_map": [[0, 1.5]]}, "invalid_coupling_map"),
        ("coupling_map boolean entries", {"coupling_map": [[0, True]]}, "invalid_coupling_map"),
        ("optimization_level too high", {"optimization_level": 4}, "invalid_optimization_level"),
        ("optimization_level negative", {"optimization_level": -1}, "invalid_optimization_level"),
        ("optimization_level boolean", {"optimization_level": True}, "invalid_optimization_level"),
        ("optimization_level non-int", {"optimization_level": 1.5}, "invalid_optimization_level"),
    ],
)
def test_rejects_invalid_transpile_request_matrix(name: str, changes: dict, error: str) -> None:
    with pytest.raises(ProtocolError, match=f"^{error}$"):
        parse_request(transpile_request_bytes(**changes))


def test_parse_forbids_transpile_only_fields() -> None:
    value = json.loads(request_bytes(action="parse"))
    del value["shots"]
    value["basis_gates"] = ["u"]

    with pytest.raises(ProtocolError, match="^transpile_fields_forbidden$"):
        parse_request(json.dumps(value).encode("utf-8"))


def test_simulate_forbids_transpile_only_fields() -> None:
    value = json.loads(request_bytes())
    value["optimization_level"] = 1

    with pytest.raises(ProtocolError, match="^transpile_fields_forbidden$"):
        parse_request(json.dumps(value).encode("utf-8"))
