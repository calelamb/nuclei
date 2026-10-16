"""Find the source line that declares a detector (``D<k>``) or observable (``L<k>``).

For a mutated DETECTOR the real cause is the declaration line, not the
reset/measurement where Stim noticed the collapse, so the explanation links
both. Detector numbering follows Stim's: one per DETECTOR instruction, in
execution order, with REPEAT bodies contributing ``body.num_detectors`` per
iteration (so a million-iteration loop is never unrolled).
"""

from __future__ import annotations

import re

import stim

from kernel.qec.explain_source_map import SourceNode

_TARGET_RE = re.compile(r"^([DL])(\d+)$")


def _detector_line(
    circuit: stim.Circuit, nodes: tuple[SourceNode, ...], index: int
) -> int | None:
    seen = 0
    for instruction, node in zip(circuit, nodes):
        if isinstance(instruction, stim.CircuitRepeatBlock):
            body = instruction.body_copy()
            per_pass = body.num_detectors
            span = per_pass * instruction.repeat_count
            if index < seen + span:
                return _detector_line(body, node.children, (index - seen) % per_pass)
            seen += span
        elif instruction.name == "DETECTOR":
            if seen == index:
                return node.first_line
            seen += 1
    return None


def _observable_line(
    circuit: stim.Circuit, nodes: tuple[SourceNode, ...], index: int
) -> int | None:
    for instruction, node in zip(circuit, nodes):
        if isinstance(instruction, stim.CircuitRepeatBlock):
            found = _observable_line(instruction.body_copy(), node.children, index)
            if found is not None:
                return found
        elif instruction.name == "OBSERVABLE_INCLUDE":
            args = instruction.gate_args_copy()
            if args and int(args[0]) == index:
                return node.first_line
    return None


def declaration_lines(
    circuit: stim.Circuit,
    source_map: tuple[SourceNode, ...] | None,
    targets: tuple[str, ...],
) -> dict[str, int]:
    """Map each ``D<k>``/``L<k>`` target to its declaring line (omitted if unknown)."""
    if source_map is None:
        return {}
    out: dict[str, int] = {}
    for target in targets:
        match = _TARGET_RE.match(target)
        if not match:
            continue
        index = int(match.group(2))
        finder = _detector_line if match.group(1) == "D" else _observable_line
        line = finder(circuit, source_map, index)
        if line is not None:
            out[target] = line
    return out
