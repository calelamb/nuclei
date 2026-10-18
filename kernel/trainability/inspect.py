"""``trainability_inspect``: what circuit does this code build, and what can
the Lab sweep?  Runs user code in-process, exactly like ``parse``."""

from __future__ import annotations

from typing import Any

from kernel.trainability._errors import TrainabilityError
from kernel.trainability._usercode import (
    LoadedCircuit,
    declared_observable,
    detect_sweepable_params,
    load_circuit,
    resolve_observable,
)
from kernel.trainability.ir import ParamCircuit, ParamRef
from kernel.trainability.pauli import PauliSum, parse_observable

__all__ = ["inspect_code", "load_for_lint", "param_gates", "source_lines"]


def param_gates(circuit: ParamCircuit) -> list[dict[str, Any]]:
    """One entry per (gate, free parameter) the gate's angles depend on."""
    out: list[dict[str, Any]] = []
    for position, gate in enumerate(circuit.gates):
        index = gate.source_index if gate.source_index is not None else position
        for angle in gate.angles:
            if isinstance(angle, ParamRef):
                out.append({"source_index": index, "parameter": angle.name, "gate": gate.name})
    return out


def source_lines(circuit: ParamCircuit) -> dict[int, int]:
    """``source_index -> 1-based line`` for gates whose line was recovered."""
    lines: dict[int, int] = {}
    for position, gate in enumerate(circuit.gates):
        if gate.source_line is not None:
            index = gate.source_index if gate.source_index is not None else position
            lines.setdefault(index, gate.source_line)
    return lines


def _declared_text(loaded: LoadedCircuit) -> str | None:
    declared = declared_observable(loaded)
    if declared is None:
        return None
    if isinstance(declared, PauliSum):
        return declared.to_text()
    # Validate eagerly so a bad declaration is reported with its column.
    parse_observable(declared, loaded.circuit.n_qubits)
    return declared.strip()


def inspect_code(
    code: str, params: dict | None = None, language: str | None = None
) -> dict[str, Any]:
    """Build the ``trainability_inspected`` payload (without ``type``)."""
    if not isinstance(code, str) or not code.strip():
        raise TrainabilityError("invalid_request", "`code` must be a non-empty string.")
    loaded = load_circuit(code, params, language)
    circuit = loaded.circuit
    return {
        "framework": circuit.framework,
        "n_qubits": circuit.n_qubits,
        "parameters": list(circuit.parameters),
        "gate_count": len(circuit.gates),
        "param_gates": param_gates(circuit),
        "sweepable_params": detect_sweepable_params(code),
        "observable_declared": _declared_text(loaded),
        "notes": list(circuit.notes),
    }


def load_for_lint(
    code: str,
    params: dict | None,
    language: str | None,
    observable: str | None,
) -> tuple[ParamCircuit, PauliSum]:
    """Circuit plus the resolved observable ."""
    loaded = load_circuit(code, params, language)
    return loaded.circuit, resolve_observable(observable, loaded)
