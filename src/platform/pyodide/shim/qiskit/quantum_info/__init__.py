"""Statevector, Operator, Pauli and fidelity helpers (browser subset)."""

import numpy as np

from _nuclei_unsupported import unsupported, make_getattr
from qiskit.exceptions import QiskitError
from qiskit import _simulate as sim
from qiskit.circuit.quantumcircuit import QuantumCircuit
from qiskit.circuit import gates as g


def _to_circuit_or_none(obj):
    if isinstance(obj, QuantumCircuit):
        return obj
    definition = getattr(obj, "definition", None)
    if isinstance(obj, g.Instruction) and definition is not None:
        return definition
    return None


class Pauli:
    """A Pauli string such as Pauli('XZ'); label's last char acts on qubit 0."""

    _MATS = {"I": g._I, "X": g._X, "Y": g._Y, "Z": g._Z}

    def __init__(self, label):
        if not isinstance(label, str) or not label or any(c not in "IXYZ" for c in label.upper().lstrip("+-")):
            raise QiskitError(f"Invalid Pauli label {label!r}")
        text = label.upper()
        self._phase = -1.0 if text.startswith("-") else 1.0
        self.label = text.lstrip("+-")
        self.num_qubits = len(self.label)

    def to_matrix(self):
        out = np.array([[self._phase]], dtype=complex)
        for ch in self.label:
            out = np.kron(out, self._MATS[ch])
        return out

    def anticommutes(self, other):
        a, b = self.to_matrix(), other.to_matrix()
        return bool(np.allclose(a @ b, -(b @ a)))

    def commutes(self, other):
        a, b = self.to_matrix(), other.to_matrix()
        return bool(np.allclose(a @ b, b @ a))

    def __str__(self):
        return ("-" if self._phase < 0 else "") + self.label

    __repr__ = lambda self: f"Pauli('{self}')"


class Operator:
    def __init__(self, data):
        circ = _to_circuit_or_none(data)
        if circ is not None:
            self.data = _circuit_unitary(circ)
        elif isinstance(data, Pauli):
            self.data = data.to_matrix()
        elif isinstance(data, g.Gate):
            self.data = data.to_matrix()
        elif isinstance(data, Operator):
            self.data = data.data.copy()
        else:
            self.data = np.asarray(data, dtype=complex)
        if self.data.ndim != 2 or self.data.shape[0] != self.data.shape[1]:
            raise QiskitError("Operator data must be a square matrix")
        self.num_qubits = int(round(np.log2(self.data.shape[0])))
        self.dim = self.data.shape

    def equiv(self, other, atol=1e-8):
        other = other if isinstance(other, Operator) else Operator(other)
        if self.data.shape != other.data.shape:
            return False
        flat_a, flat_b = self.data.ravel(), other.data.ravel()
        idx = int(np.argmax(np.abs(flat_a)))
        if abs(flat_b[idx]) < 1e-12:
            return False
        phase = flat_a[idx] / flat_b[idx]
        return bool(np.allclose(flat_a, phase * flat_b, atol=atol))

    def adjoint(self):
        return Operator(self.data.conj().T)

    def compose(self, other, front=False):
        other = other if isinstance(other, Operator) else Operator(other)
        return Operator(other.data @ self.data if not front else self.data @ other.data)

    def tensor(self, other):
        return Operator(np.kron(self.data, other.data))

    def to_matrix(self):
        return self.data

    def __eq__(self, other):
        return isinstance(other, Operator) and self.data.shape == other.data.shape and np.allclose(self.data, other.data)

    __hash__ = None

    def __repr__(self):
        return f"Operator({np.array2string(self.data, precision=3)})"


def _circuit_unitary(circuit):
    n = circuit.num_qubits
    sim.check_size(n)
    dim = 2**n
    cols = [sim.statevector(circuit, initial=np.eye(dim, dtype=complex)[:, k]) for k in range(dim)]
    return np.stack(cols, axis=1)


class Statevector:
    def __init__(self, data, dims=None):
        circ = _to_circuit_or_none(data)
        if circ is not None:
            self.data = sim.statevector(circ)
        elif isinstance(data, Statevector):
            self.data = data.data.copy()
        else:
            self.data = np.asarray(data, dtype=complex).ravel()
        n = int(round(np.log2(len(self.data)))) if len(self.data) else 0
        if 2**n != len(self.data):
            raise QiskitError("Statevector length must be a power of 2")
        self.num_qubits = n
        self.dim = len(self.data)

    @classmethod
    def from_instruction(cls, instruction):
        circ = _to_circuit_or_none(instruction)
        if circ is None:
            if isinstance(instruction, g.Gate):
                circ = QuantumCircuit(instruction.num_qubits)
                circ.append(instruction, list(range(instruction.num_qubits)))
            else:
                raise QiskitError("from_instruction expects a QuantumCircuit or gate")
        return cls(sim.statevector(circ))

    @classmethod
    def from_int(cls, i, dims):
        data = np.zeros(dims, dtype=complex)
        data[i] = 1
        return cls(data)

    @classmethod
    def from_label(cls, label):
        vecs = {
            "0": [1, 0], "1": [0, 1],
            "+": [2**-0.5, 2**-0.5], "-": [2**-0.5, -(2**-0.5)],
            "r": [2**-0.5, 1j * 2**-0.5], "l": [2**-0.5, -1j * 2**-0.5],
        }
        out = np.array([1], dtype=complex)
        for ch in label:  # leftmost char is the highest qubit
            if ch not in vecs:
                raise QiskitError(f"Invalid Statevector label {label!r}")
            out = np.kron(out, np.array(vecs[ch], dtype=complex))
        return cls(out)

    def evolve(self, other, qargs=None):
        circ = _to_circuit_or_none(other)
        if circ is not None:
            if qargs is None:
                return Statevector(sim.statevector(circ, initial=self.data))
            wrapper = QuantumCircuit(self.num_qubits)
            wrapper.append(other if isinstance(other, g.Instruction) else circ.to_instruction(), list(qargs))
            return Statevector(sim.statevector(wrapper, initial=self.data))
        if isinstance(other, g.Gate):
            qs = list(range(other.num_qubits)) if qargs is None else list(qargs)
            return Statevector(sim.apply_matrix(self.data, other.to_matrix(), qs, self.num_qubits))
        mat = other.data if isinstance(other, Operator) else np.asarray(other, dtype=complex)
        k = int(round(np.log2(mat.shape[0])))
        qs = list(range(k)) if qargs is None else list(qargs)
        return Statevector(sim.apply_matrix(self.data, mat, qs, self.num_qubits))

    def probabilities(self, qargs=None, decimals=None):
        probs = np.abs(self.data) ** 2
        if qargs is not None:
            probs = _marginal(probs, self.num_qubits, list(qargs))
        return np.round(probs, decimals) if decimals is not None else probs

    def probabilities_dict(self, qargs=None, decimals=None):
        probs = self.probabilities(qargs, decimals)
        width = self.num_qubits if qargs is None else len(list(qargs))
        return {format(i, f"0{width}b"): float(p) for i, p in enumerate(probs) if p > 1e-12}

    def expectation_value(self, oper, qargs=None):
        mat = oper.to_matrix() if isinstance(oper, Pauli) else (oper.data if isinstance(oper, Operator) else np.asarray(oper))
        if qargs is not None:
            evolved = sim.apply_matrix(self.data, mat, list(qargs), self.num_qubits)
        else:
            evolved = mat @ self.data
        return complex(np.vdot(self.data, evolved))

    def inner(self, other):
        return complex(np.vdot(self.data, other.data))

    def equiv(self, other, rtol=1e-5, atol=1e-8):
        return abs(abs(self.inner(other)) - 1) < max(atol, rtol)

    def is_valid(self, atol=1e-8):
        return bool(abs(np.linalg.norm(self.data) - 1) < atol)

    def tensor(self, other):
        return Statevector(np.kron(self.data, other.data))

    def sample_counts(self, shots=1024, qargs=None):
        rng = np.random.default_rng()
        probs = self.probabilities(qargs)
        samples = rng.choice(len(probs), size=shots, p=probs / probs.sum())
        width = self.num_qubits if qargs is None else len(list(qargs))
        uniq, counts = np.unique(samples, return_counts=True)
        return {format(int(u), f"0{width}b"): int(c) for u, c in zip(uniq, counts)}

    def __eq__(self, other):
        return isinstance(other, Statevector) and self.data.shape == other.data.shape and np.allclose(self.data, other.data)

    __hash__ = None

    def __len__(self):
        return self.dim

    def __iter__(self):
        return iter(self.data)

    def __getitem__(self, key):
        return self.data[key]

    def to_operator(self):
        return Operator(np.outer(self.data, self.data.conj()))

    def __repr__(self):
        return f"Statevector({np.array2string(self.data, precision=5, separator=', ')},\n            dims={tuple([2] * self.num_qubits)})"

    def draw(self, output="text", **_ignored):
        if output not in ("text", "latex_source", None):
            unsupported(f"Statevector.draw(output={output!r})")
        return repr(self)


def _marginal(probs, n, qargs):
    tensor = probs.reshape((2,) * n)
    keep_axes = [n - 1 - q for q in qargs]
    drop = tuple(a for a in range(n) if a not in keep_axes)
    reduced = tensor.sum(axis=drop) if drop else tensor
    remaining = sorted(keep_axes)
    # reduced axes are ordered by original axis position; reorder so that
    # qargs[0] is the least significant bit of the output index.
    order = [remaining.index(n - 1 - q) for q in reversed(qargs)]
    return np.transpose(reduced, order).reshape(-1)


def state_fidelity(state1, state2, validate=True):
    a = state1.data if isinstance(state1, Statevector) else np.asarray(state1, dtype=complex)
    b = state2.data if isinstance(state2, Statevector) else np.asarray(state2, dtype=complex)
    return float(abs(np.vdot(a, b)) ** 2)


__getattr__ = make_getattr("qiskit.quantum_info")
