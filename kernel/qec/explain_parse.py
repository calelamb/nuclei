"""Parse Stim's human-readable circuit-analysis errors into structured data.

Stim reports non-deterministic detectors/observables (and invalid measurement
references) as a multi-line ``ValueError`` message. There is no structured
API for it, so the text is parsed here with tolerant regexes; every field is
optional and a missing field degrades to ``None`` rather than a guess.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import stim

_KIND_RE = re.compile(r"The circuit contains non-deterministic (detectors|observables)")
_OP_RE = re.compile(r"analyzing (?:an? )?(.+?) on:[ \t]*\n((?:[ \t]+\S.*\n)+)")
_ANTICOMMUTE_RE = re.compile(
    r"anti-commuted with these detectors/observables:[ \t]*\n((?:[ \t]+\S.*\n)+)"
)
_SENS_RE = re.compile(
    r"backward-propagating error sensitivity for (\S+) was:[ \t]*\n((?:[ \t]+[XYZ]\d+.*\n)+)"
)
_BASIS_OP_RE = re.compile(r"^(?:an? )?([XYZ])-basis (.+)$")
_TICK_RE = re.compile(r"during TICK layer #(\d+) of (\d+)")
_INSTR_RE = re.compile(r"at (?:block's )?instruction #(\d+) \[which is (.+?)\]\s*$", re.MULTILINE)
_DIAGRAM_TICK_RE = re.compile(r"tick=range\((\d+),\s*(\d+)\)")
_DIAGRAM_FILTER_RE = re.compile(r"filter_coords=\[([^\]]*)\]")
_QUBIT_RE = re.compile(r"\d+")
_COORDS_RE = re.compile(r"\[coords[^\]]*\]")
_MEASURE_BEFORE_START = "before the beginning of time"
_TARGET_RE = re.compile(r"^([DL])(\d+)$")


@dataclass(frozen=True)
class StimAnalysisError:
    """Everything recoverable from one Stim analysis error message."""

    raw_message: str
    kind: str  # "detector" | "observable" | "invalid_reference" | "other"
    targets: tuple[str, ...]
    operation: str | None
    qubits: tuple[int, ...]
    sensitivity: str | None
    tick: int | None
    instruction_path: tuple[int, ...]  # 0-based, outermost first
    instruction_texts: tuple[str, ...]
    diagram_tick: tuple[int, int] | None
    diagram_filter: tuple[str, ...]
    #: ``(target, "X1*Z2")`` for every detector/observable Stim printed a sensitivity for.
    sensitivities: tuple[tuple[str, str], ...] = ()

    @property
    def detector_indices(self) -> tuple[int, ...]:
        return _indices(self.targets, "D")

    @property
    def observable_indices(self) -> tuple[int, ...]:
        return _indices(self.targets, "L")


def _indices(targets: tuple[str, ...], prefix: str) -> tuple[int, ...]:
    out = []
    for t in targets:
        m = _TARGET_RE.match(t)
        if m and m.group(1) == prefix:
            out.append(int(m.group(2)))
    return tuple(out)


def parse_stim_error(message: str) -> StimAnalysisError:
    message = message.rstrip() + "\n"
    op = _OP_RE.search(message)
    anti = _ANTICOMMUTE_RE.search(message)
    all_sens = tuple(
        (m.group(1), "*".join(_first_tokens(m.group(2)))) for m in _SENS_RE.finditer(message)
    )
    layer = _TICK_RE.search(message)
    frames = _INSTR_RE.findall(message)
    d_tick = _DIAGRAM_TICK_RE.search(message)
    d_filter = _DIAGRAM_FILTER_RE.search(message)
    targets = _first_tokens(anti.group(1)) if anti else ()
    return StimAnalysisError(
        raw_message=message,
        kind=_refine_kind(_classify(message), targets),
        targets=targets,
        operation=op.group(1).strip() if op else None,
        qubits=tuple(int(q) for q in _QUBIT_RE.findall(_COORDS_RE.sub("", op.group(2)))) if op else (),
        sensitivity=all_sens[0][1] if all_sens else None,
        tick=int(layer.group(1)) - 1 if layer else None,
        instruction_path=tuple(int(n) - 1 for n, _ in frames),
        instruction_texts=tuple(text for _, text in frames),
        diagram_tick=(int(d_tick.group(1)), int(d_tick.group(2))) if d_tick else None,
        diagram_filter=_parse_filter(d_filter.group(1)) if d_filter else (),
        sensitivities=all_sens,
    )


def _refine_kind(kind: str, targets: tuple[str, ...]) -> str:
    """Stim's header says "observables" whenever any observable is involved, even
    alongside detectors; the listed targets are the authority."""
    if kind not in ("detector", "observable") or not targets:
        return kind
    return "detector" if _indices(targets, "D") else "observable"


def _first_tokens(block: str) -> tuple[str, ...]:
    """First whitespace-separated token of each non-empty line (drops coords)."""
    return tuple(line.split()[0] for line in block.splitlines() if line.strip())


def _classify(message: str) -> str:
    m = _KIND_RE.search(message)
    if m:
        return "detector" if m.group(1) == "detectors" else "observable"
    if _MEASURE_BEFORE_START in message:
        return "invalid_reference"
    return "other"


def _parse_filter(inner: str) -> tuple[str, ...]:
    return tuple(p.strip().strip("'\"") for p in inner.split(",") if p.strip())


def first_failing_line(source: str) -> int | None:
    """Best-effort 1-based line of the first line Stim cannot parse alone."""
    for number, raw in enumerate(source.splitlines(), start=1):
        text = raw.split("#", 1)[0].strip()
        if not text or text.startswith("}"):
            continue
        try:
            # A REPEAT header is only valid with a closing brace; check it alone.
            stim.Circuit(text + "\n}" if text.startswith("REPEAT") else text)
        except ValueError:
            return number
    return None


def split_basis_operation(description: str | None) -> tuple[str, str] | None:
    """``"X-basis reset (RX)"`` -> ``("X", "reset (RX)")``; None for other operations."""
    match = _BASIS_OP_RE.match((description or "").strip())
    return (match.group(1), match.group(2)) if match else None
