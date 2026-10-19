#!/usr/bin/env python3
"""Fail a PRD 15 wave plan whose file ownership is inconsistent.

Checks, over the master plan (``docs/research/PRD_15_QUANTUMNESS_LAB.md``) and
the spec ownership tables (``docs/research/PRD_15/0*.md``):

1. **Wave exclusivity** -- no two units of one wave (or, with ``--scope run``,
   one run) name the same file. Patterns are compared as globs, so
   ``kernel/discovery/**`` collides with ``kernel/discovery/isolation.py``.
2. **Spec vs master** -- every file a spec ownership table lists for a master
   unit must lie inside that unit's master files. A file the master assigns to a
   *different* unit is an error ("assigned elsewhere"); a file the master never
   mentions is an error too ("not in the master"). The wave a spec puts a unit in
   must match the master's run.
3. **Master references** -- every ``§5.x`` pointer in a §7 row resolves to a
   §5 entry for the same unit and run.

Ownership data it reads:

* master ``### 5.1`` table (``| **R-A ...** (Wave 0b) | Fixes | Owned files | ... |``),
  master ``### 5.2`` ("Owned files:" bullet of unit G2);
* master ``## 7`` run tables (``| **ID** name | Scope | Owned files |``), where the
  last cell is either a file list or a ``§5.1``/``§5.2`` pointer;
* spec tables headed ``| Spec unit | Master unit (wave) | Scope | Files ... |``.

Usage::

    scripts/check-wave-ownership.py [--master PATH] [--spec PATH ...]
                                    [--scope wave|run] [--json]

Exit status: 0 when clean, 1 when there are findings, 2 on a parse problem.
Standard library only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from collections.abc import Iterable

REPO = Path(__file__).resolve().parent.parent
DEFAULT_MASTER = REPO / "docs/research/PRD_15_QUANTUMNESS_LAB.md"
DEFAULT_SPECS = sorted((REPO / "docs/research/PRD_15").glob("0[1-9]_*.md"))

TICKS = re.compile(r"`([^`]+)`")
UNIT_ID = re.compile(r"\*\*([^*]+)\*\*")
SECTION_REF = re.compile(r"§\s*(5\.[12])")
WAVE_TOKEN = re.compile(r"\(\s*Wave\s+([0-9]+[a-z]?)\s*\)")
RUN_HEADING = re.compile(r"\*\*Run\s+([0-9]+[a-z])\*\*")
WAVE_HEADING = re.compile(r"^###\s+Wave\s+([0-9]+)\b")


class PlanError(Exception):
    """The plan text does not have the shape this checker understands."""


# -- data ---------------------------------------------------------------------


@dataclass(frozen=True)
class MasterUnit:
    uid: str
    wave: str  # "0"
    run: str  # "0a"
    patterns: tuple[str, ...]
    pointer: str | None = None  # "5.1" / "5.2" when the row only points there


@dataclass(frozen=True)
class Finding:
    kind: str
    message: str

    def render(self) -> str:
        return f"[{self.kind}] {self.message}"


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def add(self, kind: str, message: str) -> None:
        self.findings.append(Finding(kind, message))


# -- file patterns ------------------------------------------------------------


def expand_braces(text: str) -> list[str]:
    """``a/{b,c/{d,e}}.py`` -> ``[a/b.py, a/c/d.py, a/c/e.py]`` (nesting allowed)."""
    start = text.find("{")
    if start < 0:
        return [text]
    depth, pieces, last = 0, [], start + 1
    for index in range(start, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                pieces.append(text[last:index])
                tail = text[index + 1 :]
                break
        elif char == "," and depth == 1:
            pieces.append(text[last:index])
            last = index + 1
    else:
        raise PlanError(f"unbalanced braces in {text!r}")
    head = text[:start]
    return [out for piece in pieces for rest in expand_braces(piece + tail) for out in [head + rest]]


def _strip_parentheticals(cell: str) -> str:
    """Drop ``( ... )`` notes outside backticks: ``path (from `old.py`)`` names one file."""
    out, depth, in_tick = [], 0, False
    for char in cell:
        if char == "`":
            in_tick = not in_tick
        if not in_tick and char == "(":
            depth += 1
        elif not in_tick and char == ")" and depth:
            depth -= 1
        elif depth == 0:
            out.append(char)
    return "".join(out)


def extract_patterns(cell: str) -> tuple[str, ...]:
    """File patterns named in a table cell: backticked tokens, braces expanded.

    Directory mentions (``scout/``) and parenthetical notes are ignored. The master
    abbreviates runs of kernel tests as ``kernel/tests/test_a.py``, ``test_b.py``,
    so a bare ``test_*`` name right after a path under ``.../tests`` inherits that
    directory; any other bare name (``CLAUDE.md``, ``playwright.config.ts``) is a
    repository-root file.
    """
    patterns: list[str] = []
    directory = ""
    for token in TICKS.findall(_strip_parentheticals(cell)):
        token = token.strip()
        if not token or " " in token or token.endswith("/"):
            continue
        for item in expand_braces(token):
            if "/" not in item and item.startswith("test_") and directory.endswith("/tests"):
                item = f"{directory}/{item}"
            if "/" in item or re.search(r"\.\w+$", item):
                patterns.append(item)
                if "/" in item:
                    directory = item.rsplit("/", 1)[0]
    return tuple(dict.fromkeys(patterns))


def _glob_regex(pattern: str) -> re.Pattern[str]:
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def _has_glob(pattern: str) -> bool:
    return any(ch in pattern for ch in "*?")


def _literal_edges(pattern: str) -> tuple[str, str]:
    first = min((pattern.find(ch) for ch in "*?" if ch in pattern), default=len(pattern))
    last = max(pattern.rfind(ch) for ch in "*?")
    return pattern[:first], pattern[last + 1 :]


def covers(owner: str, path: str) -> bool:
    """Does ``owner`` (a literal or glob) cover every file ``path`` (literal or glob) names?"""
    if owner == path:
        return True
    if not _has_glob(path):
        return bool(_glob_regex(owner).match(path))
    # a glob inside a glob: only a recursive directory glob provably covers it
    return owner.endswith("/**") and path.startswith(owner[:-2])


def overlap(a: str, b: str) -> bool:
    """Could ``a`` and ``b`` name a common file? (Conservative for glob/glob pairs.)"""
    if a == b:
        return True
    ga, gb = _has_glob(a), _has_glob(b)
    if not ga and not gb:
        return False
    if not ga:
        return bool(_glob_regex(b).match(a))
    if not gb:
        return bool(_glob_regex(a).match(b))
    (pa, sa), (pb, sb) = _literal_edges(a), _literal_edges(b)
    prefix_ok = pa.startswith(pb) or pb.startswith(pa)
    suffix_ok = sa.endswith(sb) or sb.endswith(sa)
    return prefix_ok and suffix_ok


# -- markdown tables ----------------------------------------------------------


def split_row(line: str) -> list[str]:
    inner = line.strip()
    if not (inner.startswith("|") and inner.endswith("|")):
        raise PlanError(f"not a table row: {line[:80]!r}")
    cells, current, in_tick = [], [], False
    for char in inner[1:-1]:
        if char == "`":
            in_tick = not in_tick
        if char == "|" and not in_tick:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    cells.append("".join(current).strip())
    return cells


def iter_tables(lines: list[str]) -> Iterable[tuple[int, list[str], list[list[str]]]]:
    """Yield ``(header_line_no, header_cells, rows)`` for each pipe table."""
    index = 0
    while index < len(lines):
        if lines[index].lstrip().startswith("|") and index + 1 < len(lines) and re.match(
            r"^\s*\|[\s:|-]+\|\s*$", lines[index + 1]
        ):
            header = split_row(lines[index])
            rows, cursor = [], index + 2
            while cursor < len(lines) and lines[cursor].lstrip().startswith("|"):
                rows.append(split_row(lines[cursor]))
                cursor += 1
            yield index + 1, header, rows
            index = cursor
        else:
            index += 1


# -- master parsing -------------------------------------------------------------


def _section(lines: list[str], heading: re.Pattern[str]) -> tuple[int, int]:
    """Line span ``[start, end)`` of the markdown section whose heading matches."""
    for start, line in enumerate(lines):
        if heading.match(line):
            level = len(line) - len(line.lstrip("#"))
            for end in range(start + 1, len(lines)):
                nxt = lines[end]
                if nxt.startswith("#") and len(nxt) - len(nxt.lstrip("#")) <= level:
                    return start, end
            return start, len(lines)
    raise PlanError(f"section not found: {heading.pattern}")


def parse_section_5(lines: list[str]) -> dict[str, MasterUnit]:
    """R-A..R-G from the §5.1 table and G2 from §5.2."""
    units: dict[str, MasterUnit] = {}
    start, end = _section(lines, re.compile(r"^###\s+5\.1\b"))
    for _, header, rows in iter_tables(lines[start:end]):
        if "Owned files" not in header:
            continue
        col = header.index("Owned files")
        for row in rows:
            ident = UNIT_ID.search(row[0])
            wave = WAVE_TOKEN.search(row[0])
            if not ident or not wave:
                raise PlanError(f"§5.1 row without '**ID** (Wave N)': {row[0][:60]!r}")
            uid = ident.group(1).split()[0]
            units[uid] = MasterUnit(uid, wave.group(1)[0], wave.group(1), extract_patterns(row[col]))
    start, end = _section(lines, re.compile(r"^###\s+5\.2\b"))
    body = lines[start:end]
    heading = body[0]
    ident = UNIT_ID.findall(heading)
    wave = WAVE_TOKEN.search(heading)
    owned = next((ln for ln in body if re.match(r"^-\s+Owned files:", ln)), None)
    if ident and wave and owned:
        uid = ident[-1].split()[0]
        units[uid] = MasterUnit(uid, wave.group(1)[0], wave.group(1), extract_patterns(owned))
    return units


def parse_waves(lines: list[str], section5: dict[str, MasterUnit]) -> dict[str, MasterUnit]:
    """Every unit of the §7 run tables, `§5.x` pointers resolved from section 5."""
    start, end = _section(lines, re.compile(r"^##\s+7\."))
    wave, run = None, None
    units: dict[str, MasterUnit] = {}
    index = start
    while index < end:
        line = lines[index]
        if (m := WAVE_HEADING.match(line)) is not None:
            wave, run = m.group(1), None
        elif (m := RUN_HEADING.search(line)) is not None:
            run = m.group(1)
        elif line.lstrip().startswith("|") and index + 1 < end and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[index + 1]):
            header = split_row(line)
            cursor = index + 2
            rows = []
            while cursor < end and lines[cursor].lstrip().startswith("|"):
                rows.append(split_row(lines[cursor]))
                cursor += 1
            index = cursor - 1
            if wave is not None and header and header[0].lower() == "unit":
                col = header.index("Owned files") if "Owned files" in header else None
                for row in rows:
                    unit = _master_row(row, col, wave, run or wave, section5)
                    if unit.uid in units:
                        raise PlanError(f"unit {unit.uid} appears twice in §7")
                    units[unit.uid] = unit
        index += 1
    return units


def _master_row(
    row: list[str], col: int | None, wave: str, run: str, section5: dict[str, MasterUnit]
) -> MasterUnit:
    ident = UNIT_ID.search(row[0])
    if not ident:
        raise PlanError(f"§7 row without a **unit id**: {row[0][:60]!r}")
    uid = ident.group(1).strip()
    if col is None:  # review / release units own no files
        return MasterUnit(uid, wave, run, ())
    cell = row[col]
    pointer = SECTION_REF.search(cell)
    patterns = extract_patterns(cell)
    if pointer and not patterns:
        base = section5.get(uid)
        if base is None:
            raise PlanError(f"§7 unit {uid} points at §{pointer.group(1)} but no such entry exists")
        patterns = base.patterns
    return MasterUnit(uid, wave, run, patterns, pointer.group(1) if pointer else None)


def parse_master(text: str) -> dict[str, MasterUnit]:
    lines = text.splitlines()
    return parse_waves(lines, parse_section_5(lines))


# -- spec parsing ---------------------------------------------------------------


@dataclass(frozen=True)
class SpecRow:
    spec: str
    line: int
    spec_unit: str
    units: tuple[tuple[str, str | None], ...]  # (master unit id, wave token or None)
    patterns: tuple[str, ...]


def parse_spec(path: Path) -> list[SpecRow]:
    lines = path.read_text(encoding="utf-8").splitlines()
    rows: list[SpecRow] = []
    for header_line, header, table in iter_tables(lines):
        if not (len(header) >= 4 and header[0].lower().startswith("spec unit") and "master unit" in header[1].lower()):
            continue
        files_col = next((i for i, h in enumerate(header) if h.lower().startswith("files")), len(header) - 1)
        for offset, row in enumerate(table):
            rows.append(
                SpecRow(
                    spec=path.name,
                    line=header_line + 2 + offset,
                    spec_unit=row[0],
                    units=_spec_units(row[1]),
                    patterns=extract_patterns(row[files_col]),
                )
            )
    return rows


def _spec_units(cell: str) -> tuple[tuple[str, str | None], ...]:
    """``**Q1** (Wave 2a)`` / ``**F-1 / F-2** (Wave 1) and **X** (Wave 5b)``."""
    result: list[tuple[str, str | None]] = []
    for match in UNIT_ID.finditer(cell):
        following = cell[match.end() :]
        nxt = UNIT_ID.search(following)
        window = following[: nxt.start()] if nxt else following
        wave = WAVE_TOKEN.search(window)
        ids = [part.strip() for part in re.split(r"\s+/\s+", match.group(1))]
        result.extend((ident, wave.group(1) if wave else None) for ident in ids)
    return tuple(result)


# -- checks ---------------------------------------------------------------------


def check_exclusivity(units: dict[str, MasterUnit], scope: str, report: Report) -> None:
    ordered = sorted(units.values(), key=lambda u: (u.wave, u.run, u.uid))
    for i, left in enumerate(ordered):
        for right in ordered[i + 1 :]:
            same = left.wave == right.wave if scope == "wave" else left.run == right.run
            if not same:
                continue
            for a in left.patterns:
                for b in right.patterns:
                    if overlap(a, b):
                        where = f"Wave {left.wave}" if scope == "wave" else f"Run {left.run}"
                        report.add(
                            "wave-overlap",
                            f"{where}: {left.uid} (run {left.run}) `{a}` collides with "
                            f"{right.uid} (run {right.run}) `{b}`",
                        )


def check_wave_labels(units: dict[str, MasterUnit], section5: dict[str, MasterUnit], report: Report) -> None:
    for uid, base in section5.items():
        placed = units.get(uid)
        if placed is None:
            report.add("master-reference", f"§5 defines {uid} (Wave {base.run}) but no §7 row schedules it")
        elif placed.run != base.run:
            report.add("master-reference", f"{uid} is Wave {base.run} in §5 but Run {placed.run} in §7")


def _wave_matches(spec_wave: str, master_run: str) -> bool:
    return master_run == spec_wave or master_run.startswith(spec_wave)


def check_spec(rows: list[SpecRow], units: dict[str, MasterUnit], report: Report) -> None:
    for row in rows:
        where = f"{row.spec}:{row.line} ({row.spec_unit})"
        for uid, wave in row.units:
            unit = units.get(uid)
            if unit is None:
                report.add("spec-unit", f"{where}: names master unit '{uid}', which §7 does not define")
                continue
            if wave is not None and not _wave_matches(wave, unit.run):
                report.add("spec-wave", f"{where}: puts {uid} in Wave {wave}, master has Run {unit.run}")
        for pattern in row.patterns:
            _check_spec_pattern(where, pattern, row, units, report)


def _check_spec_pattern(where: str, pattern: str, row: SpecRow, units: dict[str, MasterUnit], report: Report) -> None:
    named = [units[uid] for uid, _ in row.units if uid in units]
    if not named:
        return
    if any(covers(p, pattern) or overlap(p, pattern) for unit in named for p in unit.patterns):
        return
    elsewhere = sorted(
        {
            other.uid
            for other in units.values()
            if other not in named and any(overlap(p, pattern) for p in other.patterns)
        }
    )
    owners = "/".join(unit.uid for unit in named)
    if elsewhere:
        report.add("spec-vs-master", f"{where}: `{pattern}` is assigned to {', '.join(elsewhere)} by the master, not {owners}")
    else:
        report.add("spec-vs-master", f"{where}: `{pattern}` is not in {owners}'s master files (nor anyone's)")


def run(master_path: Path, spec_paths: list[Path], scope: str) -> Report:
    report = Report()
    text = master_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    section5 = parse_section_5(lines)
    units = parse_waves(lines, section5)
    check_exclusivity(units, scope, report)
    check_wave_labels(units, section5, report)
    for spec in spec_paths:
        check_spec(parse_spec(spec), units, report)
    report.notes.append(
        f"{len(units)} master units over {len({u.wave for u in units.values()})} waves, "
        f"{sum(len(u.patterns) for u in units.values())} file patterns, {len(spec_paths)} spec files"
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--master", type=Path, default=DEFAULT_MASTER)
    parser.add_argument("--spec", type=Path, action="append", dest="specs", help="spec file (repeatable)")
    parser.add_argument("--scope", choices=("wave", "run"), default="wave", help="exclusivity granularity")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)
    specs = args.specs if args.specs is not None else DEFAULT_SPECS
    try:
        report = run(args.master, specs, args.scope)
    except (PlanError, OSError) as exc:
        print(f"check-wave-ownership: cannot parse the plan: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps({"findings": [vars(f) for f in report.findings], "notes": report.notes}, indent=2))
    else:
        for note in report.notes:
            print(f"# {note}")
        for finding in report.findings:
            print(finding.render())
        print("OK" if not report.findings else f"FAILED: {len(report.findings)} finding(s)")
    return 1 if report.findings else 0


if __name__ == "__main__":
    sys.exit(main())
