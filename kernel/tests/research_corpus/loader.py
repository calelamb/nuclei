"""Glob-based loader for the research-program corpus (gate G0).

Layout -- every ``research_corpus/<unit>/`` directory that holds an
``expected.yaml`` is a corpus unit, picked up by a glob. A new PRD 15 unit adds
its own directory and never edits another unit's files::

    research_corpus/
      loader.py  runner.py                 (this harness -- owned by R-D)
      scout/                               (the 78-program audit corpus)
        expected.yaml
        programs/q01-bell-measured.py      (``.py`` python, ``.qs`` qsharp, ``.stim`` stim)
        programs/q40-.../main.py           (a program *directory*: ``main.<ext>`` plus
                                            sibling files, see "Project programs")
      <unit>/expected.yaml  programs/...
      <unit>/overrides.yaml                (optional; re-states another unit's expectation)

``expected.yaml`` (schema 1)::

    schema: 1
    programs:
      q02-bell-NO-measure:
        parse: ok                        # ok | error[:<code>] | timeout | closed
        execute: ok
        healthy_after: true              # the same socket still answers a parse (default)
        max_seconds: 5                   # optional latency bound on the execute phase
        max_frame_bytes: 1000000         # optional bound on any received frame
        options:                         # how to drive the program
          params: {theta: 1.1}           #   -> execute.params
          seed: 42                       #   -> execute.seed
          shots: 1024
          timeout: 90                    #   seconds per phase before the harness gives up
          phases: [parse, execute]
          request: {project_root: "$PROJECT"}   # extra fields merged into both messages
          queued_parses: 5               #   send N parses before the execute (R-8 gate)
          display: true                  #   run under an X display (Xvfb); skipped without one
          needs_interactive_backend: true  # skipped unless Matplotlib would pick a GUI backend there
          needs_memory_limit: true       #   skipped where the kernel cannot be capped (no prlimit)
        facts:                           # optional golden summary of an ok phase
          snapshot: {framework: qiskit, qubit_count: 2, depth: 2, gates: 2}
          result: {probabilities: 4, measured: 1024, bloch: 2, state_vector: 4}
        xfail:                           # a KNOWN failure; ``parse``/``execute`` above
          id: R-1                        #   are what the kernel SHOULD do (or [R-3, R-2])
          reason: "no-measure circuits cannot be run"
          current: {execute: "error:simulation_error"}   # what it does today
        note: free text
        envs:                            # per-env overrides merged over the entry
          qk2: {execute: "error:execution_error"}
          min:  {xfail: null}            # ``null`` removes a key

``overrides.yaml`` has the same shape as ``programs:`` (top level is the id map).
It lets a fixing unit flip a scout expectation (remove the ``xfail``) from its own
directory. Overrides apply in sorted unit order after every base entry is loaded.

Envs: ``min`` (kernel/requirements.txt only), ``qk2`` (Python 3.13, Qiskit 2.x,
the desktop app's catalog install), ``full`` (Python 3.12, Qiskit 1.x, the whole
CI optional stack).

Project programs: a directory ``programs/<id>/`` with ``main.<ext>`` is copied to a
temp dir per run; the string ``$PROJECT`` inside ``options.request`` values is
replaced by that copy's absolute path, so sibling-import and relative-file
programs never write into the repo.

PyYAML is a *test* dependency (not in kernel/requirements.txt); importing this
module without it works, calling the loader without it raises ``LoaderError``.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from collections.abc import Mapping

CORPUS_ROOT = Path(__file__).resolve().parent
ENVS = ("min", "qk2", "full")
PHASES = ("parse", "execute")
LANGUAGE_BY_EXTENSION = {".py": "python", ".qs": "qsharp", ".stim": "stim"}
SCHEMA_VERSION = 1

# Audit ids R-1 .. R-23 (docs/research/PRD_15/00_RELIABILITY_AUDIT.md).
RID_PATTERN = re.compile(r"^R-([1-9]|1[0-9]|2[0-3])$")
STATUS_PATTERN = re.compile(r"^(ok|timeout|closed|error(:[a-z][a-z0-9_]*)?)$")

ENTRY_KEYS = frozenset(
    {
        "parse", "execute", "healthy_after", "max_seconds", "max_frame_bytes",
        "options", "facts", "xfail", "note", "envs",
    }
)
OPTION_KEYS = frozenset(
    {
        "params", "seed", "shots", "timeout", "phases", "request", "queued_parses",
        "display", "needs_interactive_backend", "needs_memory_limit",
    }
)
XFAIL_KEYS = frozenset({"id", "reason", "current"})
DEFAULT_SHOTS = 1024
DEFAULT_TIMEOUT_SECONDS = 90.0


class LoaderError(RuntimeError):
    """The corpus on disk is malformed (or PyYAML is missing)."""


@dataclass(frozen=True)
class Xfail:
    """A known failure: the entry's expectations are what the kernel *should* do."""

    rids: tuple[str, ...]
    reason: str
    current: Mapping[str, Any]

    @property
    def label(self) -> str:
        return "+".join(self.rids)


@dataclass(frozen=True)
class Case:
    """One program resolved for one env."""

    unit: str
    id: str
    env: str
    language: str
    code: str
    project_dir: Path | None
    parse: str | None
    execute: str | None
    healthy_after: bool
    max_seconds: float | None
    max_frame_bytes: int | None
    options: Mapping[str, Any]
    facts: Mapping[str, Any]
    xfail: Xfail | None
    note: str = ""

    @property
    def phases(self) -> tuple[str, ...]:
        return tuple(self.options.get("phases") or PHASES)

    @property
    def timeout(self) -> float:
        return float(self.options.get("timeout", DEFAULT_TIMEOUT_SECONDS))

    @property
    def needs_display(self) -> bool:
        return bool(self.options.get("display", False))

    @property
    def needs_memory_limit(self) -> bool:
        return bool(self.options.get("needs_memory_limit", False))

    @property
    def needs_interactive_backend(self) -> bool:
        return bool(self.options.get("needs_interactive_backend", False))


def _yaml() -> Any:
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError as exc:  # pragma: no cover - exercised via importorskip in tests
        raise LoaderError(
            "PyYAML is required to read the research corpus "
            "(pip install pyyaml; it is a test dependency, not a kernel one)"
        ) from exc
    return yaml


def read_yaml(path: Path) -> Any:
    try:
        return _yaml().safe_load(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise LoaderError(f"cannot read {path}: {exc}") from exc
    except Exception as exc:  # yaml.YAMLError without importing yaml at module level
        if isinstance(exc, LoaderError):
            raise
        raise LoaderError(f"{path}: invalid YAML: {exc}") from exc


def deep_merge(base: Mapping[str, Any], patch: Mapping[str, Any]) -> dict[str, Any]:
    """Return ``base`` with ``patch`` merged in; ``None`` in ``patch`` deletes a key."""
    merged = copy.deepcopy(dict(base))
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        elif isinstance(value, Mapping) and isinstance(merged.get(key), Mapping):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def discover_units(root: Path = CORPUS_ROOT) -> list[Path]:
    """Every ``<root>/<unit>/`` holding an ``expected.yaml`` or ``overrides.yaml``."""
    found = {p.parent for pattern in ("*/expected.yaml", "*/overrides.yaml") for p in root.glob(pattern)}
    return sorted(found, key=lambda p: p.name)


def _program_file(unit_dir: Path, program_id: str) -> tuple[Path, Path | None]:
    """Resolve the source file (and the project dir, for directory programs)."""
    programs = unit_dir / "programs"
    directory = programs / program_id
    if directory.is_dir():
        mains = sorted(directory.glob("main.*"))
        mains = [m for m in mains if m.suffix in LANGUAGE_BY_EXTENSION]
        if len(mains) != 1:
            raise LoaderError(f"{directory}: expected exactly one main.<py|qs|stim>, found {len(mains)}")
        return mains[0], directory
    matches = [programs / f"{program_id}{ext}" for ext in LANGUAGE_BY_EXTENSION]
    matches = [m for m in matches if m.is_file()]
    if len(matches) != 1:
        raise LoaderError(f"{programs}: expected exactly one file for program '{program_id}', found {len(matches)}")
    return matches[0], None


def _read_expected(unit_dir: Path) -> dict[str, dict[str, Any]]:
    path = unit_dir / "expected.yaml"
    if not path.is_file():
        return {}
    doc = read_yaml(path)
    if not isinstance(doc, Mapping) or doc.get("schema") != SCHEMA_VERSION:
        raise LoaderError(f"{path}: top level must be a mapping with 'schema: {SCHEMA_VERSION}'")
    programs = doc.get("programs") or {}
    if not isinstance(programs, Mapping):
        raise LoaderError(f"{path}: 'programs' must be a mapping")
    return {str(k): dict(v or {}) for k, v in programs.items()}


def _read_overrides(unit_dir: Path) -> dict[str, dict[str, Any]]:
    path = unit_dir / "overrides.yaml"
    if not path.is_file():
        return {}
    doc = read_yaml(path)
    if not isinstance(doc, Mapping):
        raise LoaderError(f"{path}: top level must be a mapping of program id -> overrides")
    return {str(k): dict(v or {}) for k, v in doc.items()}


@dataclass
class _Entry:
    unit: str
    source: Path
    project_dir: Path | None
    spec: dict[str, Any] = field(default_factory=dict)


def load_entries(root: Path = CORPUS_ROOT) -> dict[str, _Entry]:
    """Base entries from every unit, then overrides, keyed by program id."""
    entries: dict[str, _Entry] = {}
    units = discover_units(root)
    for unit_dir in units:
        for program_id, spec in _read_expected(unit_dir).items():
            if program_id in entries:
                raise LoaderError(f"duplicate program id '{program_id}' ({entries[program_id].unit} and {unit_dir.name})")
            source, project = _program_file(unit_dir, program_id)
            entries[program_id] = _Entry(unit_dir.name, source, project, spec)
    for unit_dir in units:
        for program_id, patch in _read_overrides(unit_dir).items():
            if program_id not in entries:
                raise LoaderError(f"{unit_dir.name}/overrides.yaml: unknown program id '{program_id}'")
            entries[program_id].spec = deep_merge(entries[program_id].spec, patch)
    return entries


def _resolve(spec: Mapping[str, Any], env: str) -> dict[str, Any]:
    env_patch = (spec.get("envs") or {}).get(env) or {}
    base = {k: v for k, v in spec.items() if k != "envs"}
    return deep_merge(base, env_patch)


def _rids(value: Any) -> tuple[str, ...]:
    return tuple(str(v) for v in value) if isinstance(value, list) else (str(value),)


def _xfail(resolved: Mapping[str, Any]) -> Xfail | None:
    raw = resolved.get("xfail")
    if not raw:
        return None
    return Xfail(rids=_rids(raw.get("id")), reason=str(raw.get("reason", "")), current=dict(raw.get("current") or {}))


def build_case(program_id: str, entry: _Entry, env: str) -> Case:
    resolved = _resolve(entry.spec, env)
    code = entry.source.read_text(encoding="utf-8")
    return Case(
        unit=entry.unit,
        id=program_id,
        env=env,
        language=LANGUAGE_BY_EXTENSION[entry.source.suffix],
        code=code,
        project_dir=entry.project_dir,
        parse=resolved.get("parse"),
        execute=resolved.get("execute"),
        healthy_after=bool(resolved.get("healthy_after", True)),
        max_seconds=resolved.get("max_seconds"),
        max_frame_bytes=resolved.get("max_frame_bytes"),
        options=dict(resolved.get("options") or {}),
        facts=dict(resolved.get("facts") or {}),
        xfail=_xfail(resolved),
        note=str(resolved.get("note", "")),
    )


def load_cases(env: str, root: Path = CORPUS_ROOT) -> list[Case]:
    """Every program of every unit, resolved for ``env``, in (unit, id) order."""
    if env not in ENVS:
        raise LoaderError(f"unknown corpus env '{env}' (expected one of {ENVS})")
    entries = load_entries(root)
    ordered = sorted(entries.items(), key=lambda item: (item[1].unit, item[0]))
    return [build_case(program_id, entry, env) for program_id, entry in ordered]


def xfail_ledger(root: Path = CORPUS_ROOT) -> dict[str, dict[str, list[str]]]:
    """``{R-id: {env: [program ids]}}`` -- must be empty at release (master 5.3)."""
    ledger: dict[str, dict[str, list[str]]] = {}
    for env in ENVS:
        for case in load_cases(env, root):
            for rid in case.xfail.rids if case.xfail is not None else ():
                ledger.setdefault(rid, {}).setdefault(env, []).append(case.id)
    return ledger


def _check_status(label: str, value: Any, problems: list[str]) -> None:
    if value is not None and not (isinstance(value, str) and STATUS_PATTERN.match(value)):
        problems.append(f"{label}: invalid status {value!r}")


def _check_unknown(label: str, mapping: Mapping[str, Any], allowed: frozenset[str], problems: list[str]) -> None:
    for key in mapping:
        if key not in allowed:
            problems.append(f"{label}: unknown key '{key}'")


def _validate_resolved(label: str, resolved: Mapping[str, Any], problems: list[str]) -> None:
    for phase in PHASES:
        _check_status(f"{label}.{phase}", resolved.get(phase), problems)
    options = resolved.get("options") or {}
    _check_unknown(f"{label}.options", options, OPTION_KEYS, problems)
    for phase in options.get("phases") or []:
        if phase not in PHASES:
            problems.append(f"{label}.options.phases: unknown phase {phase!r}")
    if not any(resolved.get(p) for p in (options.get("phases") or PHASES)):
        problems.append(f"{label}: no expected status for any driven phase")
    xfail = resolved.get("xfail")
    if xfail:
        _check_unknown(f"{label}.xfail", xfail, XFAIL_KEYS, problems)
        for rid in _rids(xfail.get("id")):
            if not RID_PATTERN.match(rid):
                problems.append(f"{label}.xfail.id: {rid!r} is not an audit id (R-1..R-23)")
        for phase in PHASES:  # other `current` keys (seconds, frame sizes) are documentation
            _check_status(f"{label}.xfail.current.{phase}", (xfail.get("current") or {}).get(phase), problems)


def validate(root: Path = CORPUS_ROOT) -> list[str]:
    """Human-readable problems with the corpus on disk (empty list = well formed)."""
    problems: list[str] = []
    try:
        entries = load_entries(root)
    except LoaderError as exc:
        return [str(exc)]
    for program_id, entry in sorted(entries.items()):
        _check_unknown(program_id, entry.spec, ENTRY_KEYS, problems)
        for env in (entry.spec.get("envs") or {}):
            if env not in ENVS:
                problems.append(f"{program_id}.envs: unknown env '{env}'")
        for env in ENVS:
            _validate_resolved(f"{program_id}[{env}]", _resolve(entry.spec, env), problems)
    return problems
