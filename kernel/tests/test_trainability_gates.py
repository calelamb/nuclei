"""Gate matrices vs generators (expm) and vs Qiskit's gate matrices."""

import numpy as np
import pytest
from scipy.linalg import expm

from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.pauli import pauli_sum_matrix

qiskit_lib = pytest.importorskip("qiskit.circuit.library")

ANGLES = [0.0, 0.37, -1.9, 3.3]
PARAM_1 = [n for n, s in GATE_SPECS.items() if s.n_angles == 1]
ALL_NAMES = sorted(GATE_SPECS)

QISKIT_CLS = {
    "I": "IGate", "H": "HGate", "X": "XGate", "Y": "YGate", "Z": "ZGate",
    "S": "SGate", "SDG": "SdgGate", "T": "TGate", "TDG": "TdgGate",
    "SX": "SXGate", "SXDG": "SXdgGate", "CX": "CXGate", "CY": "CYGate",
    "CZ": "CZGate", "CH": "CHGate", "SWAP": "SwapGate", "ISWAP": "iSwapGate",
    "CCX": "CCXGate", "CCZ": "CCZGate", "CSWAP": "CSwapGate",
    "RX": "RXGate", "RY": "RYGate", "RZ": "RZGate", "P": "PhaseGate", "U": "UGate",
    "RXX": "RXXGate", "RYY": "RYYGate", "RZZ": "RZZGate", "RZX": "RZXGate",
    "CRX": "CRXGate", "CRY": "CRYGate", "CRZ": "CRZGate", "CP": "CPhaseGate",
}


def test_all_spec_gates_present():
    expected = set(
        "H X Y Z S SDG T TDG SX SXDG I RX RY RZ P U CX CY CZ CH SWAP ISWAP CCX CCZ CSWAP "
        "RXX RYY RZZ RZX CRX CRY CRZ CP".split()
    )
    assert set(GATE_SPECS) == expected


@pytest.mark.parametrize("name", ALL_NAMES)
def test_matrix_is_unitary(name):
    spec = GATE_SPECS[name]
    m = spec.matrix([0.4, -0.7, 1.1][: spec.n_angles])
    assert m.shape == (1 << spec.arity, 1 << spec.arity)
    assert np.allclose(m.conj().T @ m, np.eye(m.shape[0]), atol=1e-12)


@pytest.mark.parametrize("name", ALL_NAMES)
def test_matches_qiskit_matrix(name):
    spec = GATE_SPECS[name]
    angles = [0.61, -1.3, 2.2][: spec.n_angles]
    cls = getattr(qiskit_lib, QISKIT_CLS[name])
    expected = np.asarray(cls(*angles).to_matrix(), dtype=complex)
    assert np.allclose(spec.matrix(angles), expected, atol=1e-12)


@pytest.mark.parametrize("name", PARAM_1)
@pytest.mark.parametrize("theta", ANGLES)
def test_matrix_equals_expm_of_generator(name, theta):
    spec = GATE_SPECS[name]
    gen = spec.generator(list(range(spec.arity)))
    g = pauli_sum_matrix(gen, spec.arity)
    assert np.allclose(g, g.conj().T)
    assert np.allclose(spec.matrix([theta]), expm(-1j * theta * g), atol=1e-12)


def test_spec_examples_are_normative():
    rx = GATE_SPECS["RX"].generator([3]).to_text()
    assert rx == "0.5*X3"
    crz = GATE_SPECS["CRZ"].generator([0, 1])
    terms = {t.ops: t.coeff for t in crz.terms}
    assert terms == {((1, "Z"),): 0.25, ((0, "Z"), (1, "Z")): -0.25}
    cp = {t.ops: t.coeff for t in GATE_SPECS["CP"].generator([0, 1]).terms}
    assert cp[((0, "Z"), (1, "Z"))] == pytest.approx(-0.25)
    assert cp[()] == pytest.approx(-0.25)


def test_generator_maps_actual_qubits():
    g = GATE_SPECS["RZX"].generator([5, 2])
    assert g.terms[0].ops == ((2, "X"), (5, "Z"))


def test_flags():
    assert GATE_SPECS["CZ"].diagonal and GATE_SPECS["CP"].diagonal
    assert not GATE_SPECS["RX"].diagonal
    assert GATE_SPECS["CX"].clifford and not GATE_SPECS["T"].clifford
