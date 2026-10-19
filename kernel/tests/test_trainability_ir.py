"""IR JSON round-trip, strict validation, binding and hashing."""

import copy
import json

import numpy as np
import pytest

from kernel.trainability.ir import IrError, IrGate, ParamCircuit, ParamRef, ir_hash


def sample() -> ParamCircuit:
    return ParamCircuit(
        n_qubits=3,
        gates=[
            IrGate("H", (0,), (), 0, 3),
            IrGate("RX", (1,), (ParamRef("a", 2.0, 0.5),), 1),
            IrGate("CRZ", (0, 2), (ParamRef("b"),), 2),
            IrGate("RY", (2,), (0.25,), 3),
            IrGate("U", (0,), (ParamRef("a"), 0.1, ParamRef("b", -1.0)), 4),
        ],
        parameters=["a", "b"],
        framework="qiskit",
        notes=["dropped 1 measurement"],
    )


def test_json_roundtrip_is_lossless_and_serializable():
    c = sample()
    data = json.loads(json.dumps(c.to_json()))
    back = ParamCircuit.from_json(data)
    assert back == c
    assert back.to_json() == c.to_json()


def test_bind_vector_applies_coeff_and_offset():
    bound = sample().bind_vector(np.array([0.3, -0.2]))
    assert bound[0][1] == ()
    assert bound[1][1] == pytest.approx((2.0 * 0.3 + 0.5,))
    assert bound[2][1] == pytest.approx((-0.2,))
    assert bound[3][1] == (0.25,)
    assert bound[4][1] == pytest.approx((0.3, 0.1, 0.2))


def test_bind_vector_checks_length():
    with pytest.raises(IrError) as ei:
        sample().bind_vector(np.zeros(3))
    assert ei.value.code == "invalid_ir"


def mutate(fn):
    data = copy.deepcopy(sample().to_json())
    fn(data)
    return data


@pytest.mark.parametrize(
    "fn,code",
    [
        (lambda d: d.update(n_qubits=0), "invalid_ir"),
        (lambda d: d.update(n_qubits="3"), "invalid_ir"),
        (lambda d: d.update(n_qubits=10_000), "too_many_qubits"),
        (lambda d: d.update(parameters=["a", "a"]), "invalid_ir"),
        (lambda d: d.update(parameters="a"), "invalid_ir"),
        (lambda d: d.update(framework="pennylane"), "invalid_ir"),
        (lambda d: d.update(gates="x"), "invalid_ir"),
        (lambda d: d["gates"][0].update(name="FOO"), "unsupported_gate"),
        (lambda d: d["gates"][0].update(qubits=[5]), "invalid_ir"),
        (lambda d: d["gates"][0].update(qubits=[0, 1]), "invalid_ir"),
        (lambda d: d["gates"][2].update(qubits=[1, 1]), "invalid_ir"),
        (lambda d: d["gates"][0].update(angles=[0.1]), "invalid_ir"),
        (lambda d: d["gates"][3].update(angles=[float("nan")]), "invalid_ir"),
        (lambda d: d["gates"][3].update(angles=["x"]), "invalid_ir"),
        (lambda d: d["gates"][1]["angles"][0].update(param="zzz"), "invalid_ir"),
        (lambda d: d["gates"][1]["angles"][0].update(extra=1), "invalid_ir"),
        (lambda d: d["gates"][1].update(source_index=-1), "invalid_ir"),
        (lambda d: d["gates"][1].update(source_line="3"), "invalid_ir"),
    ],
)
def test_strict_from_json_rejects(fn, code):
    with pytest.raises(IrError) as ei:
        ParamCircuit.from_json(mutate(fn))
    assert ei.value.code == code


def test_from_json_rejects_non_dict():
    with pytest.raises(IrError):
        ParamCircuit.from_json([])  # type: ignore[arg-type]


def test_ir_hash_stable_and_semantic():
    a, b = sample(), sample()
    assert ir_hash(a) == ir_hash(b)
    assert len(ir_hash(a)) == 64
    # provenance does not change the hash
    b.gates[0] = IrGate("H", (0,), (), 99, 77)
    b.notes.append("x")
    assert ir_hash(a) == ir_hash(b)
    # semantics do
    b.gates[3] = IrGate("RY", (2,), (0.26,), 3)
    assert ir_hash(a) != ir_hash(b)
    c = sample()
    c.parameters = ["b", "a"]
    assert ir_hash(a) != ir_hash(c)
