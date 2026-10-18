"""Gate-append line tracing and its wiring into the converters."""

import textwrap

import pytest

from kernel.trainability.convert import from_cirq, from_object, from_qiskit
from kernel.trainability.ir import IrError
from kernel.trainability.linetrace import trace_gate_lines

qiskit = pytest.importorskip("qiskit")
cirq = pytest.importorskip("cirq")

FILENAME = "<candidate>"

QISKIT_SRC = textwrap.dedent(
    """\
    from qiskit import QuantumCircuit
    from qiskit.circuit import Parameter
    th = Parameter("th")
    qc = QuantumCircuit(3, 3)
    qc.h(0)
    qc.rx(th, 1)

    def layer(c):
        for q in range(2):
            c.cx(q, q + 1)

    layer(qc)
    qc.u(0.1, 0.2, 0.3, 2)
    qc.barrier()
    qc.measure([0, 1], [0, 1])
    """
)

CIRQ_SRC = textwrap.dedent(
    """\
    import cirq, sympy
    t = sympy.Symbol("t")
    q = cirq.LineQubit.range(2)
    circuit = cirq.Circuit(
        cirq.H(q[0]),
        cirq.rx(t).on(q[1]),
        cirq.CNOT(q[0], q[1]) ** t,
        cirq.measure(*q),
    )
    """
)


def run(src):
    ns: dict = {}
    with trace_gate_lines(FILENAME) as lines:
        exec(compile(src, FILENAME, "exec"), ns)
    return ns, lines


def test_qiskit_lines_recorded_and_attached():
    ns, lines = run(QISKIT_SRC)
    ir = from_qiskit(ns["qc"], line_map=lines)
    got = [(g.name, g.source_index, g.source_line) for g in ir.gates]
    assert got == [
        ("H", 0, 5),
        ("RX", 1, 6),
        ("CX", 2, 10),   # appended inside layer(); the line of c.cx(...)
        ("CX", 3, 10),
        ("RZ", 4, 13),  # U decomposition shares the line
        ("RY", 4, 13),
        ("RZ", 4, 13),
    ]


def test_without_a_map_lines_are_none():
    ns, _ = run(QISKIT_SRC)
    ir = from_qiskit(ns["qc"])
    assert all(g.source_line is None for g in ir.gates)


def test_other_filenames_do_not_leak():
    ns: dict = {}
    with trace_gate_lines(FILENAME) as lines:
        exec(compile(QISKIT_SRC, "<other>", "exec"), ns)
    assert from_qiskit(ns["qc"], line_map=lines).gates[0].source_line is None
    assert not lines


def test_patches_are_removed_after_exit():
    from qiskit import QuantumCircuit

    before = (QuantumCircuit._append, QuantumCircuit.copy)
    run(QISKIT_SRC)
    assert (QuantumCircuit._append, QuantumCircuit.copy) == before
    from cirq.ops.gate_operation import GateOperation

    init = GateOperation.__init__
    run(CIRQ_SRC)
    assert GateOperation.__init__ is init


def test_patches_removed_on_error():
    from qiskit import QuantumCircuit

    before = QuantumCircuit._append
    with pytest.raises(RuntimeError):
        with trace_gate_lines(FILENAME):
            raise RuntimeError("boom")
    assert QuantumCircuit._append is before


def test_copy_carries_lines_but_mutation_invalidates():
    src = textwrap.dedent(
        """\
        from qiskit import QuantumCircuit
        qc = QuantumCircuit(2)
        qc.h(0)
        qc.cx(0, 1)
        dup = qc.copy()
        """
    )
    ns, lines = run(src)
    dup_ir = from_qiskit(ns["dup"], line_map=lines)
    assert [g.source_line for g in dup_ir.gates] == [3, 4]
    # Delete the first instruction: indices shift, fingerprints no longer match.
    qc = ns["qc"]
    del qc.data[0]
    ir = from_qiskit(qc, line_map=lines)
    assert [g.source_line for g in ir.gates] == [None]


def test_compose_keeps_copied_lines_and_leaves_unknown_none():
    src = textwrap.dedent(
        """\
        from qiskit import QuantumCircuit
        a = QuantumCircuit(2)
        a.h(0)
        b = QuantumCircuit(2)
        b.x(1)
        c = a.compose(b)
        c.cx(0, 1)
        """
    )
    ns, lines = run(src)
    ir = from_qiskit(ns["c"], line_map=lines)
    assert [(g.name, g.source_line) for g in ir.gates] == [("H", 3), ("X", None), ("CX", 7)]


def test_cirq_lines_best_effort():
    ns, lines = run(CIRQ_SRC)
    ir = from_cirq(ns["circuit"], line_map=lines)
    by_name = {(g.name): g.source_line for g in ir.gates}
    assert by_name["H"] == 5
    assert by_name["RX"] == 6
    assert by_name["CRX"] == 7 and by_name["P"] == 7


def test_from_object_accepts_line_map():
    ns, lines = run(QISKIT_SRC)
    ir = from_object(ns["qc"], line_map=lines)
    assert ir.gates[0].source_line == 5


def test_nested_contexts_each_get_their_lines():
    outer_ns: dict = {}
    with trace_gate_lines(FILENAME) as outer:
        with trace_gate_lines(FILENAME) as inner:
            exec(compile("from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\n", FILENAME, "exec"), outer_ns)
    assert from_qiskit(outer_ns["qc"], line_map=outer).gates[0].source_line == 3
    assert from_qiskit(outer_ns["qc"], line_map=inner).gates[0].source_line == 3


def test_conditioned_instruction_is_unsupported():
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2, 1)
    qc.h(0)
    qc.measure(0, 0)
    with qc.if_test((qc.clbits[0], 1)):
        qc.x(1)
    with pytest.raises(IrError) as e:
        from_qiskit(qc)
    assert e.value.code == "unsupported_gate"
