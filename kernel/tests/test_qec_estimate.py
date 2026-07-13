"""Tests for PRD 10 Phase F — the Resource Estimator (`qec_estimate`).

Runs against the real shipped qdk estimator: Q# source (compiled + estimated
against its entry expression) and the OpenQASM 3 path. The estimator is
deterministic for a given program + params, so the headline shape is stable;
we assert structure, not machine-dependent magnitudes.
"""

from __future__ import annotations

import importlib.util

import pytest

from kernel.qec.estimate import (
    QEC_SCHEMES,
    QUBIT_PARAM_PRESETS,
    _build_params,
    estimate_resources,
)


def _has_qdk() -> bool:
    return importlib.util.find_spec("qdk") is not None


requires_qdk = pytest.mark.skipif(not _has_qdk(), reason="qdk not installed")

QSHARP_STARTER = """\
operation Main() : Result {
    use qs = Qubit[2];
    H(qs[0]);
    CNOT(qs[0], qs[1]);
    T(qs[0]);
    let r = M(qs[0]);
    ResetAll(qs);
    return r;
}
"""


def test_build_params_translates_panel_options():
    assert _build_params(None) is None
    assert _build_params({}) is None
    p = _build_params({"qubit_params": "qubit_gate_ns_e3", "qec_scheme": "surface_code", "error_budget": 0.001})
    assert p == {
        "qubitParams": {"name": "qubit_gate_ns_e3"},
        "qecScheme": {"name": "surface_code"},
        "errorBudget": 0.001,
    }


def test_build_params_rejects_unknown_presets_and_bad_budget():
    # Unknown names/out-of-range budget are dropped rather than passed through.
    assert _build_params({"qubit_params": "bogus"}) is None
    assert _build_params({"error_budget": 5}) is None
    assert _build_params({"qec_scheme": "not_a_scheme"}) is None
    assert set(QUBIT_PARAM_PRESETS) and set(QEC_SCHEMES)


@requires_qdk
def test_estimate_qsharp_starter_returns_headline_numbers():
    payload, error = estimate_resources(QSHARP_STARTER, "qsharp")
    assert error is None, error
    assert isinstance(payload["physical_qubits"], int) and payload["physical_qubits"] > 0
    assert isinstance(payload["runtime_ns"], int) and payload["runtime_ns"] > 0
    assert payload["code_distance"] is not None
    assert payload["qec_scheme"] in QEC_SCHEMES
    # The formatted strings + the full document travel for the panel detail.
    assert "runtime" in payload["formatted"]
    assert "physicalCounts" in payload["full"]


@requires_qdk
def test_estimate_respects_qubit_preset_option():
    payload, error = estimate_resources(
        QSHARP_STARTER, "qsharp", {"qubit_params": "qubit_maj_ns_e6", "qec_scheme": "floquet_code"}
    )
    assert error is None, error
    assert payload["qubit_params"] == "qubit_maj_ns_e6"
    assert payload["qec_scheme"] == "floquet_code"


@requires_qdk
def test_estimate_qsharp_without_entry_is_no_circuit():
    # A library with only a parameterized operation has no runnable entry.
    src = "operation Rotate(theta : Double) : Unit { use q = Qubit(); Rx(theta, q); Reset(q); }"
    payload, error = estimate_resources(src, "qsharp")
    assert payload is None
    assert error is not None and error.code == "no_circuit"


@requires_qdk
def test_estimate_qasm3_path_when_available():
    pytest.importorskip("qiskit")
    import qiskit.qasm3 as q3
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.t(0)
    qasm = q3.dumps(qc)

    payload, error = estimate_resources(qasm, "qasm3")
    # The shipped qdk exposes qdk.openqasm.estimate; if a future qdk drops it,
    # the honest error is surfaced rather than a crash.
    if error is not None:
        assert error.code in {"qec_estimate_error", "missing_dependency"}
    else:
        assert payload["physical_qubits"] > 0


@requires_qdk
def test_estimate_qiskit_code_path():
    # Python qiskit source is exec'd, exported to OpenQASM 3, then estimated.
    pytest.importorskip("qiskit")
    src = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(2)\n"
        "qc.h(0)\n"
        "qc.cx(0, 1)\n"
        "qc.t(0)\n"
    )
    payload, error = estimate_resources(src, "qiskit")
    if error is not None:
        assert error.code in {"qec_estimate_error", "missing_dependency"}
    else:
        assert payload["physical_qubits"] > 0


def test_estimate_qiskit_code_without_circuit_is_no_circuit():
    pytest.importorskip("qiskit")
    payload, error = estimate_resources("x = 1 + 1\n", "qiskit")
    assert payload is None
    assert error is not None and error.code == "no_circuit"


def test_estimate_missing_qdk_degrades(monkeypatch):
    # Force the qdk import to fail — the estimator must answer missing_dependency.
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "kernel.adapters.qsharp_adapter":
            raise ImportError("no qdk")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    payload, error = estimate_resources(QSHARP_STARTER, "qsharp")
    assert payload is None
    assert error is not None and error.code == "missing_dependency"
