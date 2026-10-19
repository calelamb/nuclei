"""Evaluator contract: spec dataclass, results, config handling, fingerprint.

New evaluators live in ``kernel/discovery/evaluators/<kind>.py``; they import
from THIS module (not from the package ``__init__``) and are registered in
``evaluators/__init__.py``. See ``qec_memory.py`` for a complete example.
"""

from __future__ import annotations

import ast
import copy
import hashlib
import json
import os
import threading
from dataclasses import dataclass, field
from typing import Any, Callable

from kernel.discovery.constants import ERR_INVALID_CONFIG, VALID_STAGES

try:  # jsonschema is preferred; a hand validator covers its absence.
    import jsonschema
except ImportError:  # pragma: no cover - exercised via validate_by_hand directly
    jsonschema = None  # type: ignore[assignment]

_DISCOVERY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PACKAGE = "kernel.discovery"

Progress = Callable[[float, str], None]


class InvalidConfig(ValueError):
    """An evaluator config failed validation (wire code ``invalid_config``)."""

    code = ERR_INVALID_CONFIG


@dataclass
class EvaluationCore:
    """What ``EvaluatorSpec.score`` returns; the manager wraps it into the 6.4 record."""

    status: str  # "scored" | "rejected" | "failed"
    fitness: float | None = None
    objectives: dict[str, Any] = field(default_factory=dict)
    descriptors: dict[str, Any] = field(default_factory=dict)
    metrics: dict[str, Any] = field(default_factory=dict)
    guardrails: list[dict[str, Any]] = field(default_factory=list)
    rejection: dict[str, Any] | None = None
    failure: dict[str, Any] | None = None
    compute: dict[str, Any] = field(default_factory=lambda: {"backend": "numpy", "method": None})

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "fitness": self.fitness if self.status == "scored" else None,
            "objectives": self.objectives,
            "descriptors": self.descriptors,
            "metrics": self.metrics,
            "guardrails": self.guardrails,
            "rejection": self.rejection,
            "failure": self.failure,
            "compute": self.compute,
        }


@dataclass(frozen=True)
class EvaluatorSpec:
    kind: str
    version: str
    title: str
    description: str
    task: str  # "stim_circuit" | "quantum_circuit"
    entry_signature: str
    objectives: list[dict[str, Any]]
    descriptors: list[dict[str, Any]]
    config_schema: dict[str, Any]
    default_config: dict[str, Any]
    stages: dict[str, dict[str, Any]]
    calls: Callable[[dict[str, Any]], list[dict[str, Any]]]
    score: Callable[..., EvaluationCore]
    default_entry: str = "build"
    validate_extra: Callable[[dict[str, Any]], str | None] | None = None

    def to_json(self) -> dict[str, Any]:
        """The wire shape emitted by ``discovery_evaluators_result``."""
        return {
            "kind": self.kind,
            "version": self.version,
            "title": self.title,
            "description": self.description,
            "task": self.task,
            "entry_signature": self.entry_signature,
            "objectives": copy.deepcopy(self.objectives),
            "descriptors": copy.deepcopy(self.descriptors),
            "config_schema": copy.deepcopy(self.config_schema),
            "default_config": copy.deepcopy(self.default_config),
            "stages": copy.deepcopy(self.stages),
        }


# --- config -----------------------------------------------------------------


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Return a new dict: ``override`` layered over ``base`` (nested dicts merge)."""
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def validate_by_hand(schema: dict[str, Any], value: Any, path: str = "config") -> None:
    """Minimal JSON-Schema subset validator used when ``jsonschema`` is absent."""
    if "anyOf" in schema:
        errors = []
        for option in schema["anyOf"]:
            try:
                validate_by_hand(option, value, path)
                return
            except InvalidConfig as exc:
                errors.append(str(exc))
        raise InvalidConfig(f"{path}: matches none of the allowed forms ({'; '.join(errors)})")
    if "const" in schema and value != schema["const"]:
        raise InvalidConfig(f"{path}: must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise InvalidConfig(f"{path}: must be one of {schema['enum']}")
    expected = schema.get("type")
    if expected is not None:
        _check_type(expected, value, path)
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        if "minimum" in schema and value < schema["minimum"]:
            raise InvalidConfig(f"{path}: must be >= {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            raise InvalidConfig(f"{path}: must be <= {schema['maximum']}")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            raise InvalidConfig(f"{path}: too short")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            raise InvalidConfig(f"{path}: needs at least {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise InvalidConfig(f"{path}: allows at most {schema['maxItems']} items")
        if "items" in schema:
            for index, item in enumerate(value):
                validate_by_hand(schema["items"], item, f"{path}[{index}]")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                raise InvalidConfig(f"{path}.{key}: is required")
        for key, item in value.items():
            if key in props:
                validate_by_hand(props[key], item, f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                raise InvalidConfig(f"{path}.{key}: unknown option")


def _check_type(expected: str | list[str], value: Any, path: str) -> None:
    kinds = expected if isinstance(expected, list) else [expected]
    checks = {
        "string": lambda v: isinstance(v, str),
        "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
        "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
        "boolean": lambda v: isinstance(v, bool),
        "array": lambda v: isinstance(v, list),
        "object": lambda v: isinstance(v, dict),
        "null": lambda v: v is None,
    }
    if not any(checks[k](value) for k in kinds):
        raise InvalidConfig(f"{path}: expected {' or '.join(kinds)}")


def validate_schema(schema: dict[str, Any], config: Any, *, use_jsonschema: bool = True) -> None:
    if jsonschema is not None and use_jsonschema:
        validator = jsonschema.Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(config), key=lambda e: list(e.absolute_path))
        if errors:
            first = errors[0]
            location = ".".join(["config", *[str(p) for p in first.absolute_path]])
            raise InvalidConfig(f"{location}: {first.message}")
        return
    validate_by_hand(schema, config)


def normalize_config(spec: EvaluatorSpec, config: Any) -> dict[str, Any]:
    """Defaults layered under ``config``, then schema + semantic validation."""
    if config is None:
        config = {}
    if not isinstance(config, dict):
        raise InvalidConfig("config: must be an object")
    merged = deep_merge(spec.default_config, config)
    validate_schema(spec.config_schema, merged)
    if spec.validate_extra is not None:
        problem = spec.validate_extra(merged)
        if problem:
            raise InvalidConfig(f"config: {problem}")
    return merged


def effective_config(spec: EvaluatorSpec, config: dict[str, Any], stage: str) -> dict[str, Any]:
    """Apply the stage's overrides (spec 6.6) to an already-normalized config."""
    if stage not in VALID_STAGES:
        raise InvalidConfig(f"stage: must be one of {list(VALID_STAGES)}")
    return deep_merge(config, spec.stages.get(stage, {}))


# --- fingerprint --------------------------------------------------------------


def _module_path(dotted: str) -> str | None:
    """File for a ``kernel.discovery...`` module name; ``__init__`` files are excluded."""
    if not dotted.startswith(_PACKAGE + "."):
        return None
    relative = dotted[len(_PACKAGE) + 1:].split(".")
    candidate = os.path.join(_DISCOVERY_DIR, *relative) + ".py"
    return candidate if os.path.isfile(candidate) else None


def _imported_discovery_modules(source: str) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module)
            found.update(f"{node.module}.{alias.name}" for alias in node.names)
    return {name for name in found if name.startswith(_PACKAGE + ".")}


def source_closure(module_name: str) -> dict[str, bytes]:
    """Bytes of ``module_name`` plus every ``kernel/discovery/*.py`` module it imports (transitively)."""
    out: dict[str, bytes] = {}
    pending = [module_name]
    while pending:
        name = pending.pop()
        if name in out:
            continue
        path = _module_path(name)
        if path is None:
            continue
        with open(path, "rb") as handle:
            data = handle.read()
        out[name] = data
        pending.extend(_imported_discovery_modules(data.decode("utf-8")))
    return out


_closure_cache: dict[str, bytes] = {}
_closure_lock = threading.Lock()


def fingerprint(kind: str, config: dict[str, Any], module_name: str | None = None) -> str:
    """Full 64-hex SHA-256 over evaluator source closure and canonical config.

    ``config`` should be the *normalized* (defaults-filled) config so two
    spellings of the same effective config share a fingerprint. Imported
    ``__init__.py`` files are excluded on purpose (the registry must not
    change every evaluator's fingerprint).
    """
    from kernel.discovery.evaluators import EVALUATORS

    spec = EVALUATORS[kind]
    module = module_name or spec.score.__module__
    with _closure_lock:
        blob = _closure_cache.get(module)
        if blob is None:
            digest = hashlib.sha256()
            for name, data in sorted(source_closure(module).items()):
                digest.update(name.encode() + b"\0" + data + b"\0")
            blob = digest.digest()
            _closure_cache[module] = blob
    final = hashlib.sha256()
    final.update(kind.encode() + b"\0")
    final.update(blob)
    final.update(canonical_json(config).encode("utf-8"))
    return final.hexdigest()
