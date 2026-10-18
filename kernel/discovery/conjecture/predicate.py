"""A tiny, safe predicate language over ``extract_features`` keys.

Grammar (JSON, no code evaluation anywhere)::

    predicate := {"all": [predicate, ...]} | {"any": [predicate, ...]} | leaf
    leaf      := {"feature": <key>, "op": "=="|"!="|"<"|"<="|">"|">="|"in", "value": <scalar | list>}

Feature names are looked up in a fixed whitelist (:data:`FEATURES`) and values
are only ever compared with the operator functions below; attribute access,
``eval`` and dunder tricks are structurally impossible because a feature name
that is not an exact whitelist member is rejected with its path.

Validation errors are :class:`SpecError` carrying a path such as
``feature_predicate.all[1].op``. ``None`` is the always-true predicate.
"""

from __future__ import annotations

import operator
from typing import Any, Callable

from kernel.discovery.conjecture.errors import SpecError

MAX_DEPTH = 6
MAX_NODES = 64
MAX_IN_LIST = 32
ENTANGLERS = ("cx", "cy", "cz", "iswap", "swap", "other", "mixed", "none")
PATTERNS = ("ladder", "brick", "ring", "all_to_all", "nearest_neighbor", "long_range", "none")
OPS = ("==", "!=", "<", "<=", ">", ">=", "in")

#: key -> (type, description, allowed string values or None)
FEATURES: dict[str, tuple[str, str, tuple[str, ...] | None]] = {
    "n_qubits": ("integer", "Number of qubits (measured at the family's largest n).", None),
    "n_params": ("integer", "Number of free parameters.", None),
    "parametric_gates": ("integer", "Number of gates with a free parameter.", None),
    "params_per_qubit": ("number", "Free parameters divided by qubits.", None),
    "two_qubit_gates": ("integer", "Weighted two-qubit gate cost.", None),
    "two_qubit_depth": ("integer", "Two-qubit layer depth.", None),
    "rotation_axes": ("string", "Sorted single-qubit rotation axes present, e.g. 'YZ'.", None),
    "entangler": ("string", "Fixed entangler kind: cx, cy, cz, iswap, swap, other, mixed, none.", ENTANGLERS),
    "entangler_pattern": ("string", "Entangler schedule: ladder, brick, ring, all_to_all, nearest_neighbor, "
                          "long_range, none.", PATTERNS),
    "distinct_bonds": ("integer", "Number of distinct qubit pairs coupled.", None),
    "connectivity_fraction": ("number", "Distinct bonds over all possible pairs.", None),
    "n_layers": ("integer", "Number of repeated layers.", None),
    "two_qubit_gates_per_layer": ("number", "Two-qubit gate cost per layer.", None),
    "params_per_layer": ("number", "Free parameters per layer.", None),
    "rotation_axis_counts.X": ("integer", "Count of parametric X rotations.", None),
    "rotation_axis_counts.Y": ("integer", "Count of parametric Y rotations.", None),
    "rotation_axis_counts.Z": ("integer", "Count of parametric Z rotations.", None),
}
_ORDERED = ("<", "<=", ">", ">=")
_FUNCS: dict[str, Callable[[Any, Any], bool]] = {
    "==": operator.eq, "!=": operator.ne, "<": operator.lt, "<=": operator.le,
    ">": operator.gt, ">=": operator.ge, "in": lambda a, b: a in b,
}


def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and abs(x) != float("inf")


def _check_scalar(key: str, value: Any, path: str) -> None:
    kind, _, allowed = FEATURES[key]
    if kind == "string":
        if not isinstance(value, str):
            raise SpecError(path, f"feature '{key}' is a string; value must be a string")
        if allowed is not None and value not in allowed:
            raise SpecError(path, f"'{value}' is not a valid value of '{key}' (one of {', '.join(allowed)})")
    elif not _is_number(value):
        raise SpecError(path, f"feature '{key}' is numeric; value must be a finite number")


def _validate_leaf(node: dict, path: str) -> None:
    extra = set(node) - {"feature", "op", "value"}
    if extra:
        raise SpecError(path, f"unexpected keys {sorted(map(str, extra))}")
    key = node.get("feature")
    if not isinstance(key, str) or key not in FEATURES:
        raise SpecError(f"{path}.feature", f"unknown feature {str(key)[:60]!r}; see the schema for valid features")
    op = node.get("op")
    if op not in OPS:
        raise SpecError(f"{path}.op", f"op must be one of {', '.join(OPS)}")
    if "value" not in node:
        raise SpecError(f"{path}.value", "missing value")
    if FEATURES[key][0] == "string" and op in _ORDERED:
        raise SpecError(f"{path}.op", f"ordering operators do not apply to string feature '{key}'")
    value = node["value"]
    if op == "in":
        if not isinstance(value, list) or not 1 <= len(value) <= MAX_IN_LIST:
            raise SpecError(f"{path}.value", f"'in' needs a list of 1 to {MAX_IN_LIST} values")
        for i, item in enumerate(value):
            _check_scalar(key, item, f"{path}.value[{i}]")
    else:
        _check_scalar(key, value, f"{path}.value")


def _validate(node: Any, path: str, depth: int, budget: list[int]) -> None:
    budget[0] += 1
    if budget[0] > MAX_NODES:
        raise SpecError(path, f"predicate has more than {MAX_NODES} nodes")
    if depth > MAX_DEPTH:
        raise SpecError(path, f"predicate is nested deeper than {MAX_DEPTH} levels")
    if not isinstance(node, dict):
        raise SpecError(path, "predicate node must be an object")
    groups = [k for k in ("all", "any") if k in node]
    if groups:
        if len(node) != 1:
            raise SpecError(path, "a group node must have exactly one key, 'all' or 'any'")
        children = node[groups[0]]
        if not isinstance(children, list) or not children:
            raise SpecError(f"{path}.{groups[0]}", "must be a non-empty list of predicates")
        for i, child in enumerate(children):
            _validate(child, f"{path}.{groups[0]}[{i}]", depth + 1, budget)
        return
    _validate_leaf(node, path)


def validate(predicate: Any, path: str = "feature_predicate") -> None:
    """Raise :class:`SpecError` (with a path) unless ``predicate`` is well formed. ``None`` is valid."""
    if predicate is None:
        return
    _validate(predicate, path, 1, [0])


def _lookup(features: dict[str, Any], key: str) -> Any:
    if key.startswith("rotation_axis_counts."):
        counts = features.get("rotation_axis_counts") or {}
        return counts.get(key.split(".", 1)[1], 0)
    return features.get(key)


def _eval(node: dict, features: dict[str, Any]) -> bool:
    if "all" in node:
        return all(_eval(child, features) for child in node["all"])
    if "any" in node:
        return any(_eval(child, features) for child in node["any"])
    actual = _lookup(features, node["feature"])
    if actual is None:
        return False  # a feature the circuit does not have can never satisfy a constraint
    try:
        return bool(_FUNCS[node["op"]](actual, node["value"]))
    except TypeError:
        return False


def evaluate(predicate: Any, features: dict[str, Any]) -> bool:
    """Evaluate ``predicate`` on ``features`` (validated first, so unsafe input raises ``SpecError``)."""
    validate(predicate)
    return True if predicate is None else _eval(predicate, features)


def predicate_schema() -> dict[str, Any]:
    """JSON Schema (draft 2020-12) of the predicate language for tool-schema builders."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "FeaturePredicate",
        "oneOf": [{"type": "null"}, {"$ref": "#/$defs/node"}],
        "$defs": {
            "node": {"oneOf": [{"$ref": "#/$defs/group"}, {"$ref": "#/$defs/leaf"}]},
            "group": {
                "type": "object", "minProperties": 1, "maxProperties": 1,
                "properties": {
                    "all": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/node"}},
                    "any": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/node"}},
                },
                "additionalProperties": False,
            },
            "leaf": {
                "type": "object", "required": ["feature", "op", "value"], "additionalProperties": False,
                "properties": {
                    "feature": {"enum": list(FEATURES)},
                    "op": {"enum": list(OPS)},
                    "value": {"type": ["number", "string", "array"]},
                },
            },
        },
        "x-limits": {"max_depth": MAX_DEPTH, "max_nodes": MAX_NODES, "max_in_list": MAX_IN_LIST},
    }
