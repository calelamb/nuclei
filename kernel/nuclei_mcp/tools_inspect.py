"""inspect_circuit: minimal structural facts about a stim circuit."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import stim

from .errors import ToolInputError
from .journal import sha256_text

MAX_CIRCUIT_BYTES = 20_000_000


def read_circuit_text(*, stim_text: str | None, path: str | None) -> str:
    if (stim_text is None) == (path is None):
        raise ToolInputError("provide exactly one of stim_text or path")
    if stim_text is not None:
        text = stim_text
    else:
        file = Path(path).expanduser()  # type: ignore[arg-type]
        if not file.is_file():
            raise ToolInputError(f"circuit file not found: {path}")
        if file.stat().st_size > MAX_CIRCUIT_BYTES:
            raise ToolInputError(f"circuit file exceeds {MAX_CIRCUIT_BYTES} bytes")
        text = file.read_text(encoding="utf-8")
    if not text.strip():
        raise ToolInputError("circuit is empty")
    return text


def parse_circuit(text: str) -> stim.Circuit:
    try:
        return stim.Circuit(text)
    except ValueError as exc:
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else "invalid circuit"
        raise ToolInputError(f"not a valid stim circuit: {first}") from exc


def explain_nondeterministic_detectors(circuit: stim.Circuit) -> dict[str, Any] | None:
    """TODO(explain): hook for kernel/qec/explain.py (separate branch).

    When that module lands, call it here to explain WHY detectors are
    non-deterministic. Deliberately not implemented in this branch.
    """
    return None


def _graphlike_distance(circuit: stim.Circuit) -> tuple[int | None, str | None]:
    try:
        return len(circuit.shortest_graphlike_error()), None
    except ValueError as exc:
        first = str(exc).strip().splitlines()[0] if str(exc).strip() else "unknown stim error"
        return None, first


def inspect_circuit(text: str) -> dict[str, Any]:
    circuit = parse_circuit(text)
    distance, reason = _graphlike_distance(circuit)
    result: dict[str, Any] = {
        "circuit_sha256": sha256_text(text),
        "num_qubits": circuit.num_qubits,
        "num_measurements": circuit.num_measurements,
        "num_detectors": circuit.num_detectors,
        "num_observables": circuit.num_observables,
        "graphlike_distance": distance,
        "distance_method": "stim.Circuit.shortest_graphlike_error (length of shortest undetectable graphlike logical error)",
    }
    if distance is None:
        result["graphlike_distance_unavailable_reason"] = reason
        result["nondeterministic_detector_explanation"] = explain_nondeterministic_detectors(circuit)
    return result
