"""Explain why a QEC circuit fails (CRITIC.md #11).

Two static analyses of a Stim circuit, each built on Stim's own machinery:

* :func:`explain_nondeterministic` - catches the "non-deterministic detector /
  observable" error and turns it into structured data (which detector, which
  operation, tick, qubits, source line) plus Stim's own ``detslice-with-ops-svg``
  diagram.
* :func:`min_weight_logical_error` - finds a minimum-weight undetected logical
  error and maps each physical fault back to a tick / qubits / gate / source line.

Both analyse the circuit *as written*. They say nothing about sampled data and
never propose or apply a fix.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import stim

from kernel.qec.explain_parse import StimAnalysisError, first_failing_line, parse_stim_error
from kernel.qec.explain_source_map import (
    SourceNode,
    line_for_target,
    resolve_path,
    verified_source_map,
)

SEARCH_FALLBACK_LIMITS = ((4, 4), (6, 6))
GRAPHLIKE_CAVEAT = (
    "Weight counts physical faults of the circuit's graphlike error mechanisms "
    "(each flips at most two detectors). It is an upper bound on the true "
    "circuit-level distance, not a proof of the distance."
)
NONDETERMINISM_HEDGE = (
    "This is a static property of the circuit text, independent of noise or "
    "sampled data. Common sources are a shifted or missing DETECTOR rec target, "
    "a wrong rec offset, or a measurement/reset in the wrong basis."
)


def _parse_circuit(text: str) -> tuple[stim.Circuit | None, dict[str, Any] | None]:
    try:
        return stim.Circuit(text), None
    except ValueError as exc:
        message = str(exc).strip()
        line = first_failing_line(text)
        where = f" (line {line})" if line else ""
        return None, {
            "status": "parse_error",
            "line": line,
            "stim_message": message,
            "sentence": f"Stim could not parse this circuit{where}: {message}",
        }


def _line_text(source: str, line: int | None) -> str | None:
    lines = source.splitlines()
    if line is None or line < 1 or line > len(lines):
        return None
    return lines[line - 1].strip()


def _locate(
    source_map: tuple[SourceNode, ...] | None, path: tuple[int, ...], target_index: int | None
) -> tuple[int | None, list[int]]:
    node = resolve_path(source_map, list(path)) if source_map is not None else None
    if node is None:
        return None, []
    return line_for_target(node, target_index), list(node.lines)


def _target_index(info: StimAnalysisError) -> int | None:
    if not info.instruction_texts or not info.qubits:
        return None
    try:
        targets = stim.Circuit(info.instruction_texts[-1])[0].targets_copy()
    except (ValueError, IndexError):
        return None
    for index, target in enumerate(targets):
        if target.value == info.qubits[0] and not target.is_combiner:
            return index
    return None


def _diagram_svg(circuit: stim.Circuit, info: StimAnalysisError) -> str | None:
    if info.diagram_tick is None or not info.diagram_filter:
        return None
    start, stop = info.diagram_tick
    try:
        return str(
            circuit.diagram(
                "detslice-with-ops-svg",
                tick=range(start, stop),
                filter_coords=list(info.diagram_filter),
            )
        )
    except (ValueError, TypeError):
        return None


def _nondeterministic_sentence(info: StimAnalysisError, line: int | None) -> str:
    noun = "detector" if info.kind == "detector" else "observable"
    names = ", ".join(info.targets) or f"a {noun}"
    qubits = ", ".join(str(q) for q in info.qubits)
    qubit_phrase = f" on qubit{'s' if len(info.qubits) != 1 else ''} {qubits}" if qubits else ""
    op = info.operation or "operation"
    where = []
    if line is not None:
        where.append(f"line {line}")
    if info.tick is not None:
        where.append(f"after {info.tick} TICK{'s' if info.tick != 1 else ''}")
    where_text = f" ({', '.join(where)})" if where else ""
    sens = f" The Pauli it is sensitive to there is {info.sensitivity}." if info.sensitivity else ""
    return (
        f"{noun.capitalize()} {names} is non-deterministic: the {op}{qubit_phrase}"
        f"{where_text} anti-commutes with what {names} tracks, so its parity is random "
        f"even without noise.{sens} {NONDETERMINISM_HEDGE}"
    )


def _invalid_reference_sentence(info: StimAnalysisError, line: int | None) -> str:
    text = info.instruction_texts[-1] if info.instruction_texts else "an instruction"
    where = f" at line {line}" if line is not None else ""
    return (
        f"The circuit is invalid{where}: {text} refers to a measurement result that "
        "does not exist yet (the rec offset reaches before the first measurement)."
    )


def explain_nondeterministic(circuit_text: str) -> dict[str, Any]:
    """Explain a non-deterministic detector/observable, or report why not.

    ``status`` is one of ``ok`` (Stim found nothing wrong), ``nondeterministic``,
    ``invalid_circuit`` or ``parse_error``.
    """
    circuit, failure = _parse_circuit(circuit_text)
    if circuit is None:
        return failure or {"status": "parse_error", "sentence": "Could not parse the circuit."}
    try:
        circuit.detector_error_model()
    except ValueError as exc:
        return _describe_failure(circuit_text, circuit, str(exc))
    return {
        "status": "ok",
        "sentence": (
            "Stim found no non-deterministic detectors or observables in this circuit "
            "(checked by building its detector error model)."
        ),
    }


def _describe_failure(source: str, circuit: stim.Circuit, message: str) -> dict[str, Any]:
    info = parse_stim_error(message)
    if info.tick is None and circuit.num_ticks == 0:
        info = replace(info, tick=0)
    source_map = verified_source_map(source, circuit)
    line, lines = _locate(source_map, info.instruction_path, _target_index(info))
    base = {
        "kind": info.kind,
        "stim_message": message.strip(),
        "line": line,
        "lines": lines,
        "line_text": _line_text(source, line),
        "tick": info.tick,
    }
    if info.kind in ("detector", "observable"):
        return {
            **base,
            "status": "nondeterministic",
            "detector_indices": list(info.detector_indices),
            "observable_indices": list(info.observable_indices),
            "targets": list(info.targets),
            "operation": {
                "description": info.operation,
                "qubits": list(info.qubits),
                "instruction": info.instruction_texts[-1] if info.instruction_texts else None,
            },
            "sensitivity": info.sensitivity,
            "diagram_svg": _diagram_svg(circuit, info),
            "sentence": _nondeterministic_sentence(info, line),
        }
    if info.kind == "invalid_reference":
        return {
            **base,
            "status": "invalid_circuit",
            "sentence": _invalid_reference_sentence(info, line),
        }
    return {**base, "status": "invalid_circuit", "sentence": f"Stim rejected this circuit: {message.strip()}"}


def _fault_qubits(location: Any) -> list[int]:
    if len(location.flipped_pauli_product) > 0:
        return [t.gate_target.value for t in location.flipped_pauli_product]
    flipped = location.flipped_measurement
    if flipped is not None:
        return [t.gate_target.value for t in flipped.observable]
    return []


def _pauli_letter(target: Any) -> str:
    if target.is_x_target:
        return "X"
    if target.is_y_target:
        return "Y"
    return "Z" if target.is_z_target else "?"


def _pauli_text(location: Any) -> str | None:
    if len(location.flipped_pauli_product) == 0:
        return None
    return "*".join(_pauli_letter(t.gate_target) + str(t.gate_target.value)
                    for t in location.flipped_pauli_product)


def _instruction_text(location: Any) -> str:
    it = location.instruction_targets
    args = f"({', '.join(str(a) for a in it.args)})" if it.args else ""
    targets = " ".join(str(t.gate_target.value) for t in it.targets_in_range)
    return f"{it.gate}{args} {targets}".strip()


def _describe_fault(
    explained: Any, source: str, source_map: tuple[SourceNode, ...] | None, index: int
) -> dict[str, Any]:
    terms = [str(t.dem_target) for t in explained.dem_error_terms]
    base = {
        "index": index,
        "detectors": [t for t in terms if t.startswith("D")],
        "observables": [t for t in terms if t.startswith("L")],
    }
    if not explained.circuit_error_locations:
        return {**base, "located": False, "tick": None, "qubits": [], "gate": None,
                "instruction": None, "line": None, "line_text": None, "pauli": None}
    loc = explained.circuit_error_locations[0]
    path = tuple(f.instruction_offset for f in loc.stack_frames)
    line, _ = _locate(source_map, path, loc.instruction_targets.target_range_start)
    return {
        **base,
        "located": True,
        "tick": loc.tick_offset,
        "qubits": _fault_qubits(loc),
        "gate": loc.instruction_targets.gate,
        "instruction": _instruction_text(loc),
        "pauli": _pauli_text(loc),
        "line": line,
        "line_text": _line_text(source, line),
        "iteration": loc.stack_frames[-1].iteration_index if loc.stack_frames else None,
    }


def _find_logical_error(circuit: stim.Circuit) -> tuple[list[Any] | None, str | None]:
    try:
        found = circuit.shortest_graphlike_error(canonicalize_circuit_errors=True)
        if found:
            return list(found), "shortest_graphlike_error"
    except ValueError:
        pass
    for event_limit, degree_limit in SEARCH_FALLBACK_LIMITS:
        try:
            found = circuit.search_for_undetectable_logical_errors(
                dont_explore_detection_event_sets_with_size_above=event_limit,
                dont_explore_edges_with_degree_above=degree_limit,
                dont_explore_edges_increasing_symptom_degree=True,
                canonicalize_circuit_errors=True,
            )
        except ValueError:
            continue
        if found:
            return list(found), "search_for_undetectable_logical_errors"
    return None, None


def _no_error_sentence(circuit: stim.Circuit) -> str:
    if circuit.num_observables == 0:
        return "No logical observable is declared (OBSERVABLE_INCLUDE), so there is no logical error to search for."
    return (
        "No undetectable logical error was found. The circuit may have no noise "
        "channels, or the search limits were too tight to find one; this is not a "
        "proof that none exists."
    )


def min_weight_logical_error(circuit_text: str) -> dict[str, Any]:
    """Find a minimum-weight undetected logical error and locate its faults."""
    circuit, failure = _parse_circuit(circuit_text)
    if circuit is None:
        return failure or {"status": "parse_error", "sentence": "Could not parse the circuit."}
    try:
        circuit.detector_error_model()
    except ValueError as exc:
        return _describe_failure(circuit_text, circuit, str(exc))
    counts = {"num_detectors": circuit.num_detectors, "num_observables": circuit.num_observables}
    found, method = _find_logical_error(circuit)
    if not found:
        return {"status": "none_found", **counts, "sentence": _no_error_sentence(circuit)}
    source_map = verified_source_map(circuit_text, circuit)
    faults = [_describe_fault(e, circuit_text, source_map, i) for i, e in enumerate(found)]
    weight = len(faults)
    exact = method == "shortest_graphlike_error"
    sentence = (
        f"The smallest undetected logical error found has weight {weight}: {weight} "
        f"physical fault{'s' if weight != 1 else ''} that together flip a logical "
        "observable without firing any detector. "
        + ("" if exact else "Found by a bounded heuristic search, so a smaller one may exist. ")
        + GRAPHLIKE_CAVEAT
    )
    return {
        "status": "ok",
        "method": method,
        "weight": weight,
        "weight_is_upper_bound": True,
        "caveat": GRAPHLIKE_CAVEAT,
        **counts,
        "faults": faults,
        "sentence": sentence,
    }
