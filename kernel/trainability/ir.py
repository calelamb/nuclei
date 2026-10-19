"""Parameterized circuit IR for the Trainability Lab.

Conventions
-----------
* Qubit ``q`` is bit ``q`` of the basis index (little-endian).
* An angle is a float or a :class:`ParamRef`; the numeric angle of a ref is
  ``coeff * values[index(name)] + offset``.
* ``ParamCircuit.parameters`` is the ordered list of unique parameter names;
  every ``values`` vector in the Lab follows that order.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Any, Union

import numpy as np

from kernel.trainability.gates import GATE_SPECS

__all__ = [
    "IrError",
    "ParamRef",
    "Angle",
    "IrGate",
    "ParamCircuit",
    "ir_hash",
    "MAX_IR_QUBITS",
    "IR_VERSION",
]

IR_VERSION = 1
#: Hard cap on IR width (Pauli propagation reaches 100+ qubits; statevector
#: simulation enforces its own, smaller limit).
MAX_IR_QUBITS = 256
_FRAMEWORKS = ("qiskit", "cirq", "native")
_ERROR_CODES = (
    "unsupported_gate",
    "unsupported_object",
    "nonlinear_parameter",
    "too_many_qubits",
    "mid_circuit_measurement",
    "invalid_ir",
)


class IrError(Exception):
    """IR/converter failure; ``code`` is one of the spec's stable codes."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.code}: {self.message}"


@dataclass(frozen=True)
class ParamRef:
    """Gate angle ``coeff * value[name] + offset``."""

    name: str
    coeff: float = 1.0
    offset: float = 0.0


Angle = Union[float, ParamRef]


@dataclass(frozen=True)
class IrGate:
    name: str
    qubits: tuple[int, ...]
    angles: tuple[Angle, ...] = ()
    source_index: int | None = None
    source_line: int | None = None


@dataclass
class ParamCircuit:
    n_qubits: int
    gates: list[IrGate]
    parameters: list[str]
    framework: str = "native"
    notes: list[str] = field(default_factory=list)

    # ------------------------------------------------------------ json
    def to_json(self) -> dict[str, Any]:
        return {
            "version": IR_VERSION,
            "n_qubits": self.n_qubits,
            "gates": [_gate_to_json(g) for g in self.gates],
            "parameters": list(self.parameters),
            "framework": self.framework,
            "notes": list(self.notes),
        }

    @staticmethod
    def from_json(data: dict) -> "ParamCircuit":
        """Strictly validate and build a circuit; raises ``IrError("invalid_ir")``."""
        if not isinstance(data, dict):
            raise _bad("IR must be an object")
        n = data.get("n_qubits")
        if not _is_int(n) or n < 1:
            raise _bad("n_qubits must be a positive integer")
        if n > MAX_IR_QUBITS:
            raise IrError("too_many_qubits", f"{n} qubits exceeds the IR limit of {MAX_IR_QUBITS}")
        params = data.get("parameters")
        if not isinstance(params, list) or not all(isinstance(p, str) and p for p in params):
            raise _bad("parameters must be a list of non-empty strings")
        if len(set(params)) != len(params):
            raise _bad("parameters must be unique")
        framework = data.get("framework", "native")
        if framework not in _FRAMEWORKS:
            raise _bad(f"unknown framework {framework!r}")
        notes = data.get("notes", [])
        if not isinstance(notes, list) or not all(isinstance(x, str) for x in notes):
            raise _bad("notes must be a list of strings")
        raw_gates = data.get("gates")
        if not isinstance(raw_gates, list):
            raise _bad("gates must be a list")
        known = set(params)
        gates = [_gate_from_json(g, i, n, known) for i, g in enumerate(raw_gates)]
        return ParamCircuit(n, gates, list(params), framework, list(notes))

    # ------------------------------------------------------------ binding
    def param_index(self) -> dict[str, int]:
        return {p: i for i, p in enumerate(self.parameters)}

    def bind_vector(self, values: np.ndarray) -> list[tuple[IrGate, tuple[float, ...]]]:
        """Resolve every gate's angles for one parameter vector."""
        vec = np.asarray(values, dtype=float).reshape(-1)
        if vec.shape[0] != len(self.parameters):
            raise _bad(f"expected {len(self.parameters)} parameter values, got {vec.shape[0]}")
        index = self.param_index()
        out: list[tuple[IrGate, tuple[float, ...]]] = []
        for g in self.gates:
            angles = tuple(
                a.coeff * float(vec[index[a.name]]) + a.offset if isinstance(a, ParamRef) else float(a)
                for a in g.angles
            )
            out.append((g, angles))
        return out


def _bad(msg: str) -> IrError:
    return IrError("invalid_ir", msg)


def _is_int(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _angle_to_json(a: Angle) -> Any:
    if isinstance(a, ParamRef):
        return {"param": a.name, "coeff": a.coeff, "offset": a.offset}
    return float(a)


def _gate_to_json(g: IrGate) -> dict[str, Any]:
    return {
        "name": g.name,
        "qubits": list(g.qubits),
        "angles": [_angle_to_json(a) for a in g.angles],
        "source_index": g.source_index,
        "source_line": g.source_line,
    }


def _gate_from_json(raw: Any, i: int, n: int, known: set[str]) -> IrGate:
    where = f"gate {i}"
    if not isinstance(raw, dict):
        raise _bad(f"{where}: must be an object")
    name = raw.get("name")
    spec = GATE_SPECS.get(name) if isinstance(name, str) else None
    if spec is None:
        raise IrError("unsupported_gate", f"{where}: unknown gate {name!r}")
    qubits = raw.get("qubits")
    if (
        not isinstance(qubits, list)
        or not all(_is_int(q) for q in qubits)
        or len(qubits) != spec.arity
    ):
        raise _bad(f"{where}: {name} needs {spec.arity} integer qubits")
    if len(set(qubits)) != len(qubits) or any(q < 0 or q >= n for q in qubits):
        raise _bad(f"{where}: qubits must be distinct and in [0, {n})")
    raw_angles = raw.get("angles", [])
    if not isinstance(raw_angles, list) or len(raw_angles) != spec.n_angles:
        raise _bad(f"{where}: {name} needs {spec.n_angles} angles")
    angles = tuple(_angle_from_json(a, where, known) for a in raw_angles)
    meta: dict[str, int | None] = {}
    for key in ("source_index", "source_line"):
        v = raw.get(key)
        if v is not None and (not _is_int(v) or v < 0):
            raise _bad(f"{where}: {key} must be a non-negative integer or null")
        meta[key] = v
    return IrGate(name, tuple(qubits), angles, meta["source_index"], meta["source_line"])


def _angle_from_json(a: Any, where: str, known: set[str]) -> Angle:
    if _is_num(a):
        return float(a)
    if isinstance(a, dict):
        extra = set(a) - {"param", "coeff", "offset"}
        name = a.get("param")
        coeff = a.get("coeff", 1.0)
        offset = a.get("offset", 0.0)
        if extra or not isinstance(name, str) or not _is_num(coeff) or not _is_num(offset):
            raise _bad(f"{where}: malformed parameter reference")
        if name not in known:
            raise _bad(f"{where}: parameter {name!r} is not declared")
        return ParamRef(name, float(coeff), float(offset))
    raise _bad(f"{where}: angle must be a finite number or a parameter reference")


def ir_hash(circuit: ParamCircuit) -> str:
    """SHA-256 of the canonical JSON of the circuit's *semantics*.

    Covers ``n_qubits``, the gates (name, qubits, angles) and the ordered
    parameter list.  Provenance (``source_index``, ``source_line``,
    ``framework``, ``notes``) is excluded so two circuits that compile to the
    same program share a cache key.
    """
    payload = {
        "n": circuit.n_qubits,
        "p": list(circuit.parameters),
        "g": [[g.name, list(g.qubits), [_angle_to_json(a) for a in g.angles]] for g in circuit.gates],
    }
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
