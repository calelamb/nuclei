"""Map Stim instruction positions back to .stim source lines.

Stim fuses adjacent same-gate lines into one instruction when it parses text
(``H 0`` + ``H 1`` becomes ``H 0 1``), so the instruction numbers Stim reports
in errors and fault locations do not equal source line numbers. This module
rebuilds that numbering from the source text so a reported instruction can be
traced to the exact line(s) the user wrote.

Fusion is decided by asking Stim itself (do two adjacent lines parse to a
single instruction?), never by a hand-copied gate list. If the rebuilt numbering
cannot be confirmed against the parsed circuit the lookup returns ``None`` and
the caller reports "line unknown" rather than a wrong line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import stim

_REPEAT_RE = re.compile(r"^REPEAT\b", re.IGNORECASE)
_CLOSE_RE = re.compile(r"^\}")


@dataclass(frozen=True)
class SourceNode:
    """One Stim instruction: the source lines (1-based) it was parsed from."""

    lines: tuple[int, ...]
    line_target_counts: tuple[int, ...]
    children: tuple["SourceNode", ...] = ()

    @property
    def first_line(self) -> int:
        return self.lines[0]


def _strip(raw: str) -> str:
    return raw.split("#", 1)[0].strip()


def _target_count(text: str) -> int:
    try:
        parsed = stim.Circuit(text)
        return len(parsed[0].targets_copy()) if len(parsed) else 0
    except (ValueError, IndexError):
        return 0


def _fuses(prev_text: str, text: str) -> bool:
    try:
        return len(stim.Circuit(prev_text + "\n" + text)) == 1
    except ValueError:
        return False


def build_source_map(source: str) -> tuple[SourceNode, ...] | None:
    """Return top-level nodes with nested REPEAT bodies, or None on bad syntax."""
    raw_lines = source.splitlines()
    stack: list[list[dict]] = [[]]
    open_headers: list[dict] = []
    for number, raw in enumerate(raw_lines, start=1):
        text = _strip(raw)
        if not text:
            continue
        if _CLOSE_RE.match(text):
            if not open_headers:
                return None
            header = open_headers.pop()
            header["children"] = stack.pop()
            continue
        if _REPEAT_RE.match(text) and text.endswith("{"):
            node = {"texts": [text], "lines": [number], "counts": [0], "children": []}
            stack[-1].append(node)
            open_headers.append(node)
            stack.append([])
            continue
        _append_instruction(stack[-1], text, number)
    if open_headers:
        return None
    return _freeze(stack[0])


def _append_instruction(level: list[dict], text: str, number: int) -> None:
    previous = level[-1] if level else None
    if previous is not None and not previous["children"] and not previous["texts"][0].upper().startswith("REPEAT"):
        if _fuses(previous["texts"][-1], text):
            previous["texts"].append(text)
            previous["lines"].append(number)
            previous["counts"].append(_target_count(text))
            return
    level.append({
        "texts": [text],
        "lines": [number],
        "counts": [_target_count(text)],
        "children": [],
    })


def _freeze(level: list[dict]) -> tuple[SourceNode, ...]:
    return tuple(
        SourceNode(
            lines=tuple(n["lines"]),
            line_target_counts=tuple(n["counts"]),
            children=_freeze(n["children"]),
        )
        for n in level
    )


def resolve_path(
    nodes: tuple[SourceNode, ...] | None, offsets: list[int]
) -> SourceNode | None:
    """Follow 0-based instruction offsets (outer block first) to a node."""
    current = nodes
    node: SourceNode | None = None
    for offset in offsets:
        if current is None or offset < 0 or offset >= len(current):
            return None
        node = current[offset]
        current = node.children
    return node


def line_for_target(node: SourceNode, target_index: int | None) -> int:
    """Pick the fused source line that holds the given target index."""
    if target_index is None or len(node.lines) == 1:
        return node.first_line
    running = 0
    for line, count in zip(node.lines, node.line_target_counts):
        if target_index < running + count:
            return line
        running += count
    return node.first_line



def _matches(circuit: stim.Circuit, nodes: tuple[SourceNode, ...]) -> bool:
    if len(circuit) != len(nodes):
        return False
    for instruction, node in zip(circuit, nodes):
        if isinstance(instruction, stim.CircuitRepeatBlock):
            if not _matches(instruction.body_copy(), node.children):
                return False
        elif node.children or sum(node.line_target_counts) != len(instruction.targets_copy()):
            return False
    return True


def verified_source_map(source: str, circuit: stim.Circuit) -> tuple[SourceNode, ...] | None:
    """Source map, or None unless it provably mirrors the parsed circuit."""
    nodes = build_source_map(source)
    if nodes is None or not _matches(circuit, nodes):
        return None
    return nodes
