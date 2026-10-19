"""Program types for the Pauli Propagation Engine (re-exported by ``ppe_core``)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence, Union

Ops = tuple[tuple[int, str], ...]


@dataclass(frozen=True)
class PauliRotation:
    """``U = exp(-i * (freq/2) * theta[param] * P)`` with ``theta ~ U[0, 2pi)`` independent per param.

    ``ops`` is the Pauli string ``P`` (sorted by qubit, no identities). ``freq`` is a nonzero integer;
    RX(theta) has ``freq = 1``; a generator coefficient ``c`` on a ``ParamRef`` with coefficient ``a``
    gives ``freq = 2*c*a``.
    """

    ops: Ops
    param: int
    freq: int = 1


@dataclass(frozen=True)
class CliffordGate:
    """A fixed Clifford gate: any ``CliffordConjugator.SUPPORTED`` name."""

    name: str
    qubits: tuple[int, ...]


RotationProgram = Sequence[Union[PauliRotation, CliffordGate]]
