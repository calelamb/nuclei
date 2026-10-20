"""Instruction and standard-gate classes for the browser Qiskit subset.

Class names (HGate, CXGate, ...) and `.name` values match real Qiskit so the
snapshot extraction logic (which maps by class name) treats shim circuits and
real Qiskit circuits identically. Matrices follow Qiskit's little-endian
convention: for `qargs = [q0, q1, ...]`, q0 is the least significant bit of
the matrix index.
"""

import numpy as np

from _nuclei_unsupported import unsupported

_SQRT1_2 = 1 / np.sqrt(2)


def _c(rows):
    return np.array(rows, dtype=complex)


def controlled_matrix(u, num_ctrl):
    """Matrix of `u` controlled on `num_ctrl` low bits (controls are qargs first)."""
    u = np.asarray(u, dtype=complex)
    k = int(np.log2(u.shape[0]))
    dim = 2 ** (num_ctrl + k)
    out = np.eye(dim, dtype=complex)
    mask = (1 << num_ctrl) - 1
    for hi_in in range(2**k):
        for hi_out in range(2**k):
            out[(hi_out << num_ctrl) | mask, (hi_in << num_ctrl) | mask] = u[hi_out, hi_in]
    return out


_I = _c([[1, 0], [0, 1]])
_X = _c([[0, 1], [1, 0]])
_Y = _c([[0, -1j], [1j, 0]])
_Z = _c([[1, 0], [0, -1]])
_H = _c([[1, 1], [1, -1]]) * _SQRT1_2
_S = _c([[1, 0], [0, 1j]])
_T = _c([[1, 0], [0, np.exp(1j * np.pi / 4)]])
_SX = _c([[1 + 1j, 1 - 1j], [1 - 1j, 1 + 1j]]) / 2
_SWAP = _c([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]])


def _rx(t):
    return _c([[np.cos(t / 2), -1j * np.sin(t / 2)], [-1j * np.sin(t / 2), np.cos(t / 2)]])


def _ry(t):
    return _c([[np.cos(t / 2), -np.sin(t / 2)], [np.sin(t / 2), np.cos(t / 2)]])


def _rz(t):
    return _c([[np.exp(-1j * t / 2), 0], [0, np.exp(1j * t / 2)]])


def _p(t):
    return _c([[1, 0], [0, np.exp(1j * t)]])


def _u3(theta, phi, lam):
    return _c([
        [np.cos(theta / 2), -np.exp(1j * lam) * np.sin(theta / 2)],
        [np.exp(1j * phi) * np.sin(theta / 2), np.exp(1j * (phi + lam)) * np.cos(theta / 2)],
    ])


class Instruction:
    """A circuit operation. Gates are Instructions that have a unitary matrix."""

    def __init__(self, name, num_qubits, num_clbits=0, params=None, label=None):
        self.name = name
        self.num_qubits = num_qubits
        self.num_clbits = num_clbits
        self.params = list(params) if params else []
        self.label = label
        self.definition = None  # a QuantumCircuit for composite gates

    def copy(self):
        import copy

        return copy.copy(self)

    def to_matrix(self):
        unsupported(f"{self.name}.to_matrix()")

    def _matrix(self):
        """Unitary matrix for this op, or None when it isn't a plain unitary."""
        return None

    def inverse(self):
        unsupported(f"{self.name}.inverse()")

    def __repr__(self):
        return f"{type(self).__name__}({', '.join(repr(p) for p in self.params)})"


class Gate(Instruction):
    def __init__(self, name, num_qubits, params=None, label=None):
        super().__init__(name, num_qubits, 0, params, label)

    def to_matrix(self):
        m = self._matrix()
        if m is None:
            unsupported(f"{self.name}.to_matrix() for a composite gate")
        return m

    def inverse(self):
        m = self._matrix()
        if m is not None:
            return UnitaryGate(m.conj().T, label=self.label, name=f"{self.name}_dg")
        if self.definition is not None:
            inv = Gate(f"{self.name}_dg", self.num_qubits, self.params, self.label)
            inv.definition = self.definition.inverse()
            return inv
        return super().inverse()


class _StdGate(Gate):
    """Standard gate: subclasses set `_name`, `_nq`, `_nparams`, `_build`, `_inverse`."""

    _name = ""
    _nq = 1
    _nparams = 0

    def __init__(self, *params, label=None):
        if len(params) != self._nparams:
            raise TypeError(f"{type(self).__name__} takes {self._nparams} parameter(s)")
        super().__init__(self._name, self._nq, [float(p) for p in params], label)

    def _build(self, *params):
        raise NotImplementedError

    def _matrix(self):
        return self._build(*self.params)

    def inverse(self):
        return self._inverse()

    def _inverse(self):
        return Gate.inverse(self)

    def _neg(self):
        return type(self)(*[-p for p in self.params], label=self.label)

    def _self(self):
        return type(self)(*self.params, label=self.label)


def _std(cls_name, name, nq, nparams, build, inverse="generic"):
    def _inv(self):
        if inverse == "self":
            return self._self()
        if inverse == "neg":
            return self._neg()
        if callable(inverse):
            return inverse(self)
        return Gate.inverse(self)

    return type(cls_name, (_StdGate,), {
        "_name": name, "_nq": nq, "_nparams": nparams,
        "_build": staticmethod(build), "_inverse": _inv,
    })


IGate = _std("IGate", "id", 1, 0, lambda: _I, "self")
HGate = _std("HGate", "h", 1, 0, lambda: _H, "self")
XGate = _std("XGate", "x", 1, 0, lambda: _X, "self")
YGate = _std("YGate", "y", 1, 0, lambda: _Y, "self")
ZGate = _std("ZGate", "z", 1, 0, lambda: _Z, "self")
SGate = _std("SGate", "s", 1, 0, lambda: _S, lambda g: SdgGate(label=g.label))
SdgGate = _std("SdgGate", "sdg", 1, 0, lambda: _S.conj().T, lambda g: SGate(label=g.label))
TGate = _std("TGate", "t", 1, 0, lambda: _T, lambda g: TdgGate(label=g.label))
TdgGate = _std("TdgGate", "tdg", 1, 0, lambda: _T.conj().T, lambda g: TGate(label=g.label))
SXGate = _std("SXGate", "sx", 1, 0, lambda: _SX, lambda g: SXdgGate(label=g.label))
SXdgGate = _std("SXdgGate", "sxdg", 1, 0, lambda: _SX.conj().T, lambda g: SXGate(label=g.label))
RXGate = _std("RXGate", "rx", 1, 1, _rx, "neg")
RYGate = _std("RYGate", "ry", 1, 1, _ry, "neg")
RZGate = _std("RZGate", "rz", 1, 1, _rz, "neg")
PhaseGate = _std("PhaseGate", "p", 1, 1, _p, "neg")
U1Gate = _std("U1Gate", "u1", 1, 1, _p, "neg")
U3Gate = _std("U3Gate", "u3", 1, 3, _u3, lambda g: U3Gate(-g.params[0], -g.params[2], -g.params[1], label=g.label))
UGate = _std("UGate", "u", 1, 3, _u3, lambda g: UGate(-g.params[0], -g.params[2], -g.params[1], label=g.label))
CXGate = _std("CXGate", "cx", 2, 0, lambda: controlled_matrix(_X, 1), "self")
CYGate = _std("CYGate", "cy", 2, 0, lambda: controlled_matrix(_Y, 1), "self")
CZGate = _std("CZGate", "cz", 2, 0, lambda: controlled_matrix(_Z, 1), "self")
CHGate = _std("CHGate", "ch", 2, 0, lambda: controlled_matrix(_H, 1), "self")
CPhaseGate = _std("CPhaseGate", "cp", 2, 1, lambda t: controlled_matrix(_p(t), 1), "neg")
CRXGate = _std("CRXGate", "crx", 2, 1, lambda t: controlled_matrix(_rx(t), 1), "neg")
CRYGate = _std("CRYGate", "cry", 2, 1, lambda t: controlled_matrix(_ry(t), 1), "neg")
CRZGate = _std("CRZGate", "crz", 2, 1, lambda t: controlled_matrix(_rz(t), 1), "neg")
SwapGate = _std("SwapGate", "swap", 2, 0, lambda: _SWAP, "self")
CCXGate = _std("CCXGate", "ccx", 3, 0, lambda: controlled_matrix(_X, 2), "self")
CCZGate = _std("CCZGate", "ccz", 3, 0, lambda: controlled_matrix(_Z, 2), "self")
CSwapGate = _std("CSwapGate", "cswap", 3, 0, lambda: controlled_matrix(_SWAP, 1), "self")


class MCXGate(Gate):
    def __init__(self, num_ctrl_qubits, label=None):
        super().__init__("mcx", num_ctrl_qubits + 1, [], label)
        self.num_ctrl_qubits = num_ctrl_qubits

    def _matrix(self):
        return controlled_matrix(_X, self.num_ctrl_qubits)

    def inverse(self):
        return MCXGate(self.num_ctrl_qubits, label=self.label)


class UnitaryGate(Gate):
    """Arbitrary unitary on `n` qubits (also what inverse() of most gates becomes)."""

    def __init__(self, data, label=None, name="unitary"):
        m = np.asarray(data, dtype=complex)
        n = int(round(np.log2(m.shape[0]))) if m.ndim == 2 and m.shape[0] > 0 else 0
        if m.ndim != 2 or m.shape[0] != m.shape[1] or 2**n != m.shape[0]:
            raise ValueError("Unitary matrix must be square with a power-of-two dimension")
        if not np.allclose(m @ m.conj().T, np.eye(m.shape[0]), atol=1e-8):
            raise ValueError("Input matrix is not unitary.")
        super().__init__(name, n, [], label)
        self._m = m

    def _matrix(self):
        return self._m

    def inverse(self):
        return UnitaryGate(self._m.conj().T, label=self.label, name=f"{self.name}_dg")


class Initialize(Instruction):
    """State preparation of |0..0> into `amplitudes` (qubits must start in |0>)."""

    def __init__(self, params, num_qubits=None):
        amps = np.asarray(params, dtype=complex).ravel()
        n = int(round(np.log2(len(amps)))) if len(amps) else 0
        if 2**n != len(amps):
            raise ValueError("Initialize: amplitude vector length must be a power of two")
        if not np.isclose(np.linalg.norm(amps), 1.0, atol=1e-6):
            raise ValueError("Sum of amplitudes-squared does not equal one.")
        super().__init__("initialize", n, 0, [])
        self.amplitudes = amps

    def _matrix(self):
        return _state_prep_unitary(self.amplitudes)


def _state_prep_unitary(amps):
    """A unitary whose first column is `amps` (so U|0..0> = amps)."""
    dim = len(amps)
    basis = np.eye(dim, dtype=complex)
    basis[:, 0] = amps
    q, _ = np.linalg.qr(basis)
    phase = np.vdot(q[:, 0], amps)  # <q0|amps>, unit modulus
    q[:, 0] = q[:, 0] * phase
    return q


class Measure(Instruction):
    def __init__(self):
        super().__init__("measure", 1, 1)


class Reset(Instruction):
    def __init__(self):
        super().__init__("reset", 1, 0)


class Barrier(Instruction):
    def __init__(self, num_qubits):
        super().__init__("barrier", num_qubits, 0)

    def inverse(self):
        return Barrier(self.num_qubits)


STANDARD_GATES = {
    cls.__name__: cls
    for cls in (
        IGate, HGate, XGate, YGate, ZGate, SGate, SdgGate, TGate, TdgGate, SXGate, SXdgGate,
        RXGate, RYGate, RZGate, PhaseGate, U1Gate, U3Gate, UGate, CXGate, CYGate, CZGate,
        CHGate, CPhaseGate, CRXGate, CRYGate, CRZGate, SwapGate, CCXGate, CCZGate, CSwapGate,
    )
}
