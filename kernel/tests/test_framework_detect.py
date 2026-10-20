"""R-3: framework detection from the AST (sub-module imports, nested imports, hints)."""

from __future__ import annotations

import pytest

from kernel.framework_detect import (
    RULES,
    detect,
    framework_by_type,
    looks_like_qsharp,
    resolve_framework,
)


@pytest.mark.parametrize(
    "code, framework",
    [
        ("import qiskit", "qiskit"),
        ("import qiskit as q", "qiskit"),
        ("from qiskit import QuantumCircuit", "qiskit"),
        ("from qiskit.circuit.library import EfficientSU2", "qiskit"),
        ("from qiskit.quantum_info import SparsePauliOp", "qiskit"),
        ("import qiskit.quantum_info as qi", "qiskit"),
        ("from qiskit_aer import AerSimulator", "qiskit"),
        ("import qiskit_aer", "qiskit"),
        ("from qiskit_ibm_runtime import SamplerV2", "qiskit"),
        ("import cirq", "cirq"),
        ("import cirq as c", "cirq"),
        ("from cirq import H", "cirq"),
        ("from cirq.contrib.svg import SVGCircuit", "cirq"),
        ("import cirq_google", "cirq"),
        ("import qsimcirq", "cirq"),
        ("import cudaq", "cuda-q"),
        ("import cudaq as cq", "cuda-q"),
        ("import stim", "stim"),
        ("from stim import Circuit", "stim"),
        ("import sinter", "stim"),
        ("def build():\n    from qiskit import QuantumCircuit\n    return QuantumCircuit(1)", "qiskit"),
        ("if __name__ == '__main__':\n    import cirq", "cirq"),
        ("try:\n    import qiskit\nexcept ImportError:\n    qiskit = None", "qiskit"),
        ("import importlib\nm = importlib.import_module('qiskit')", "qiskit"),
        ("from importlib import import_module\nm = import_module('cirq.contrib')", "cirq"),
        ("m = __import__('stim')", "stim"),
        ("import cudaq\n@cudaq.kernel\ndef k():\n    pass", "cuda-q"),
        ("@cudaq.kernel()\ndef k():\n    pass", "cuda-q"),
    ],
)
def test_detect_import_forms(code: str, framework: str) -> None:
    result = detect(code, "python")
    assert result.framework == framework
    assert resolve_framework(code, language="python") == framework
    assert resolve_framework(code) == framework


@pytest.mark.parametrize(
    "code",
    [
        "# import qiskit",
        "s = 'import qiskit'",
        '"""\nimport qiskit\n"""',
        "import qiskitty",
        "import numpy",
        "from . import qiskit_helpers",
        "print('hello')",
        "",
    ],
)
def test_detect_negatives(code: str) -> None:
    assert detect(code).framework is None
    assert resolve_framework(code) is None


def test_candidates_are_ordered_by_first_appearance_then_rule_order() -> None:
    both = "import cirq\nimport qiskit\n"
    assert detect(both).candidates == ("cirq", "qiskit")
    assert detect("import qiskit\nimport cirq\n").candidates == ("qiskit", "cirq")
    assert detect(both).framework == "cirq"


def test_hints() -> None:
    q = "operation Main() : Unit { }"
    assert detect(q, "qsharp").framework == "qsharp" and detect(q, "qsharp").source_mode
    assert detect("H 0", "stim").framework == "stim" and detect("H 0", "stim").source_mode
    # A python hint never routes to a source-mode framework, even for Q#-looking text.
    assert detect("s = '''\noperation Foo() : Unit {}\n'''\nimport qiskit\n", "python").framework == "qiskit"


def test_no_hint_qsharp_routing() -> None:
    assert resolve_framework("namespace Demo {\n operation Main() : Unit {}\n}") == "qsharp"
    assert resolve_framework("operation Main() : Unit {\n}") == "qsharp"
    assert looks_like_qsharp("open Microsoft.Quantum.Intrinsic;")
    assert not looks_like_qsharp("from qiskit import QuantumCircuit")


def test_syntax_error_python_still_labelled_by_regex() -> None:
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(1\n"
    assert detect(code, "python").framework == "qiskit"
    assert detect(code, "python").method == "regex"
    assert resolve_framework(code) == "qiskit"


def test_method_labels() -> None:
    assert detect("import qiskit").method == "ast"
    assert detect("x = 1").method == "none"
    assert detect("anything", "qsharp").method == "hint"


def test_rules_have_unique_orders() -> None:
    assert len({rule.order for rule in RULES}) == len(RULES)


def test_post_exec_type_scan() -> None:
    qiskit = pytest.importorskip("qiskit")
    cirq = pytest.importorskip("cirq")
    assert framework_by_type({"x": 1}) is None
    assert framework_by_type({"qc": qiskit.QuantumCircuit(1)}) == "qiskit"
    assert framework_by_type({"c": cirq.Circuit()}) == "cirq"
    # The most recently defined circuit object decides.
    assert framework_by_type({"qc": qiskit.QuantumCircuit(1), "c": cirq.Circuit()}) == "cirq"
    assert framework_by_type({"c": cirq.Circuit(), "qc": qiskit.QuantumCircuit(1)}) == "qiskit"


def test_foreign_imports_defer_detection_to_the_post_exec_scan() -> None:
    assert detect("from ansatz_lib import build\nqc = build(3)\n").foreign_imports
    assert detect("import numpy as np\n").foreign_imports
    assert not detect("import math, os\nprint(1)\n").foreign_imports
    assert not detect("print('plain python')").foreign_imports
    assert not detect("import qiskit").foreign_imports
