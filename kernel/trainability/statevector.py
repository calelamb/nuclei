"""Unbatched convenience API over the Lab Compiler (stable names).

Used by ``kernel/discovery`` and the analyses.  All functions take a
:class:`ParamCircuit`, a 1-D ``values`` vector in ``circuit.parameters``
order, and run the batched compiler with ``B = 1``.
"""

from __future__ import annotations

import numpy as np

from kernel.trainability.compiler import MAX_STATEVECTOR_QUBITS, compile_circuit
from kernel.trainability.gates import SHIFT_4TERM_GATES
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import PauliSum
from kernel.trainability.reference import reference_expectation

__all__ = [
    "MAX_STATEVECTOR_QUBITS",
    "simulate",
    "expectation",
    "value_and_grad",
    "parameter_shift_grad",
]

# Two-term rule: f' = (f(t + pi/2) - f(t - pi/2)) / 2  (generator frequency 1).
# Four-term rule for controlled rotations (frequencies 1/2 and 1):
#   f' = c+ [f(t+pi/2) - f(t-pi/2)] - c- [f(t+3pi/2) - f(t-3pi/2)],
#   c± = (sqrt(2) ± 1) / (4 sqrt(2)).
_S2 = np.sqrt(2.0)
_C_PLUS, _C_MINUS = (_S2 + 1) / (4 * _S2), (_S2 - 1) / (4 * _S2)


def _row(values: np.ndarray) -> np.ndarray:
    return np.asarray(values, dtype=np.float64).reshape(1, -1)


def simulate(circuit: ParamCircuit, values: np.ndarray, initial: np.ndarray | None = None) -> np.ndarray:
    """Final statevector ``(2**n,)`` complex128."""
    return compile_circuit(circuit).states(_row(values), initial)[0]


def expectation(circuit: ParamCircuit, values: np.ndarray, observable: PauliSum) -> float:
    """``<psi(values)|O|psi(values)>``."""
    return float(compile_circuit(circuit).expectations(_row(values), observable)[0])


def value_and_grad(
    circuit: ParamCircuit, values: np.ndarray, observable: PauliSum
) -> tuple[float, np.ndarray]:
    """Expectation and its gradient w.r.t. ``values`` (adjoint method)."""
    val, grad = compile_circuit(circuit).value_and_grad(_row(values), observable)
    return float(val[0]), grad[0]


def _shifted(circuit: ParamCircuit, gate_pos: int, angle_pos: int, delta: float) -> ParamCircuit:
    g = circuit.gates[gate_pos]
    a = g.angles[angle_pos]
    new = ParamRef(a.name, a.coeff, a.offset + delta) if isinstance(a, ParamRef) else float(a) + delta
    angles = g.angles[:angle_pos] + (new,) + g.angles[angle_pos + 1:]
    gates = list(circuit.gates)
    gates[gate_pos] = IrGate(g.name, g.qubits, angles, g.source_index, g.source_line)
    return ParamCircuit(circuit.n_qubits, gates, list(circuit.parameters), circuit.framework, list(circuit.notes))


def parameter_shift_grad(circuit: ParamCircuit, values: np.ndarray, observable: PauliSum) -> np.ndarray:
    """Gradient by parameter-shift rules, evaluated with the reference oracle.

    Each gate *occurrence* is shifted separately (so shared and affine
    parameters are handled by the chain rule through ``ParamRef.coeff``);
    controlled rotations use the four-term rule.  For tests / validation.
    """
    vec = np.asarray(values, dtype=np.float64).reshape(-1)
    index = circuit.param_index()
    grad = np.zeros(len(circuit.parameters))

    def f(c: ParamCircuit) -> float:
        return reference_expectation(c, vec, observable)

    for pos, gate in enumerate(circuit.gates):
        for k, angle in enumerate(gate.angles):
            if not isinstance(angle, ParamRef):
                continue
            if gate.name in SHIFT_4TERM_GATES:
                d = (
                    _C_PLUS * (f(_shifted(circuit, pos, k, np.pi / 2)) - f(_shifted(circuit, pos, k, -np.pi / 2)))
                    - _C_MINUS * (f(_shifted(circuit, pos, k, 3 * np.pi / 2)) - f(_shifted(circuit, pos, k, -3 * np.pi / 2)))
                )
            else:
                d = 0.5 * (f(_shifted(circuit, pos, k, np.pi / 2)) - f(_shifted(circuit, pos, k, -np.pi / 2)))
            grad[index[angle.name]] += angle.coeff * d
    return grad
