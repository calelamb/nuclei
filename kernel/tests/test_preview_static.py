"""The static fast path: same snapshot as a real run for simple programs, bail-out for everything else."""

from __future__ import annotations

import pytest

pytest.importorskip("qiskit")
pytest.importorskip("cirq")
pytest.importorskip("qiskit_aer")

from kernel.executor import Executor
from kernel.preview_static import try_static

SIMPLE = {
    "bell": "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n",
    "ghz_range": "from qiskit import QuantumCircuit\nn = 4\nqc = QuantumCircuit(n, n)\nqc.h(0)\nqc.cx(0, 1)\nqc.cx(1, 2)\nqc.cx(2, 3)\nqc.measure(range(n), range(n))\n",
    "rotations": "import numpy as np\nfrom qiskit import QuantumCircuit\ntheta = np.pi / 3\nqc = QuantumCircuit(2)\nqc.rx(theta, 0)\nqc.ry(2 * theta, 1)\nqc.rzz(0.5, 0, 1)\nqc.barrier()\nqc.measure_all()\n",
    "registers": "from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister\nq = QuantumRegister(2, 'q')\nc = ClassicalRegister(2, 'c')\nqc = QuantumCircuit(q, c)\nqc.h(q[0])\nqc.cx(q[0], q[1])\nqc.measure(q, c)\n",
    "sinks_skipped": "from qiskit import QuantumCircuit\nfrom qiskit_aer import AerSimulator\nqc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\nbackend = AerSimulator()\njob = backend.run(qc, shots=10)\nprint(job.result().get_counts())\nqc.draw()\n",
    "parametric": "from qiskit import QuantumCircuit\nfrom qiskit.circuit import Parameter\nt = Parameter('t')\nqc = QuantumCircuit(1)\nqc.rx(t, 0)\n",
    "cirq_ops": "import cirq\nq0, q1 = cirq.LineQubit.range(2)\ncircuit = cirq.Circuit()\ncircuit.append(cirq.H(q0))\ncircuit.append([cirq.CNOT(q0, q1), cirq.measure(q0, q1, key='m')])\n",
    "cirq_rx": "import cirq\nq = cirq.LineQubit(0)\ncircuit = cirq.Circuit(cirq.rx(0.5)(q), cirq.measure(q, key='m'))\n",
}


@pytest.mark.parametrize("name", sorted(SIMPLE))
def test_static_equals_exec(name: str) -> None:
    code = SIMPLE[name]
    static = try_static(code)
    assert static is not None, f"{name} should be inside the static subset"
    executor = Executor()
    from_run, _o, _e, error = executor.parse(code)
    assert error is None
    adapter, _err = executor._load_adapter(executor._spec_named(static.framework))
    assert adapter.extract_snapshot(static.circuit).to_dict() == from_run.to_dict()


@pytest.mark.parametrize(
    "code",
    [
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(3)\nfor q in range(3):\n    qc.h(q)\n",
        "from qiskit import QuantumCircuit\ndef build():\n    return QuantumCircuit(1)\nqc = build()\n",
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\nopen('x.txt', 'w').write('1')\n",
        "from qiskit import QuantumCircuit\nimport os\nqc = QuantumCircuit(1)\n",
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(5)\n",
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.unknown_gate(0)\n",
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nvalue = mystery\n",
        "from qiskit import QuantumCircuit\nif True:\n    qc = QuantumCircuit(1)\n",
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\nqc.data.clear()\n",
        "import qiskit\nqc = qiskit.QuantumCircuit(1)\nqc.__class__.__init__ = None\n",
        "x = (",
    ],
)
def test_bails_on_anything_else(code: str) -> None:
    assert try_static(code) is None


def test_static_never_runs_user_calls(tmp_path) -> None:
    marker = tmp_path / "ran"
    code = f"from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nopen({str(marker)!r}, 'w').write('x')\n"
    assert try_static(code) is None and not marker.exists()


def test_static_needs_the_library_to_be_loaded(monkeypatch) -> None:
    import sys

    monkeypatch.delitem(sys.modules, "cirq", raising=False)
    assert try_static("import cirq\nc = cirq.Circuit()\n") is None
