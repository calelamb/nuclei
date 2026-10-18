"""Test-family generator for the Conjecture Engine (addendum section G).

A *family spec* describes a space of layered circuits. ``generate`` draws
circuits from it at random *within the family's degrees of freedom*: the layer
count within its range, the axis order inside each layer, which bonds start a
brick, optional random single-qubit Clifford dressings, and (for
``"random_subset"``) the set of rotation axes. The circuits are therefore
held out: they are new draws, never copies of archive elites.

Determinism: a circuit is a pure function of ``(family, n, seed, variant)``.
Structural randomness (layers, axis orders, brick start, axis subset) depends
only on ``(seed, variant)``, never on ``n``, so one variant is the *same
family member* at every qubit count and a scaling study over ``n`` is
meaningful. Qubit-local randomness (dressings) is keyed by
``(seed, variant, layer, qubit)`` so growing ``n`` only appends qubits.

Every gate is either a single-Pauli rotation with its own independent
parameter or a fixed Clifford, so the Pauli Propagation Engine applies
(``require_ppe=True`` asserts it). ``rzz_fixed`` is realized as
CX, RZ(pi/2), CX (a fixed Clifford ZZ interaction); ``extract_features``
therefore reports it as a ``cx`` entangler.
"""

from __future__ import annotations

import math
import random
import re
from typing import Any

from kernel.discovery.conjecture.errors import SpecError
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import ObservableError, PauliSum, parse_observable
from kernel.trainability.pauliprop import ppe_applicable

MAX_LAYERS = 32
MAX_ROTATIONS = 4
MAX_VARIANTS = 64
MAX_GATES = 40_000
AXES = ("X", "Y", "Z")
ENTANGLER_KINDS = ("cz", "cx", "rzz_fixed", "none")
PATTERN_KINDS = ("brick", "ladder", "ring", "all_to_all")
BRICK_STARTS = ("random", "even", "odd")
OBSERVABLE_PRESETS = ("preset:local_z", "preset:global_z", "preset:zz_chain")
DRESSINGS = ("H", "S", "SDG", "SX")
_TEMPLATE = re.compile(r"\{n(?:\s*([+-])\s*(\d{1,3}))?\}")
_DEFAULTS: dict[str, Any] = {
    "family": "layered", "rotation_axes": ["Y", "Z"], "entangler": "cz", "pattern": "brick",
    "layers": 2, "rotations_per_qubit_per_layer": 1, "observable": "preset:local_z",
    "variants": 8, "clifford_dressing": 0.0, "brick_start": "random",
}


class GrammarError(Exception):
    """The family cannot be realized at this size (e.g. too many gates)."""


def _int_in(value: Any, lo: int, hi: int, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise SpecError(path, f"must be an integer between {lo} and {hi}")
    return value


def _layers(value: Any, path: str) -> list[int]:
    if isinstance(value, list):
        if len(value) != 2:
            raise SpecError(path, "a layer range is [min, max]")
        lo, hi = (_int_in(v, 1, MAX_LAYERS, f"{path}[{i}]") for i, v in enumerate(value))
        if lo > hi:
            raise SpecError(path, "min must not exceed max")
        return [lo, hi]
    count = _int_in(value, 1, MAX_LAYERS, path)
    return [count, count]


def _axes(value: Any, path: str) -> list[str] | str:
    if value == "random_subset":
        return value
    if not isinstance(value, list) or not 1 <= len(value) <= 3 or len(set(map(str, value))) != len(value):
        raise SpecError(path, "must be 'random_subset' or a list of 1 to 3 distinct axes from X, Y, Z")
    for i, axis in enumerate(value):
        if axis not in AXES:
            raise SpecError(f"{path}[{i}]", "axis must be one of X, Y, Z")
    return list(value)


def resolve_observable(spec: str, n: int) -> str:
    """Substitute ``{n}``, ``{n-1}``, ``{n+k}`` in a Pauli-sum spec; presets pass through."""
    def sub(match: re.Match) -> str:
        offset = int(match.group(2) or 0) * (-1 if match.group(1) == "-" else 1)
        return str(n + offset)
    return _TEMPLATE.sub(sub, spec)


def validate_family(spec: Any, path: str = "test_family") -> dict[str, Any]:
    """Return a normalized family spec (defaults filled) or raise :class:`SpecError` with a path."""
    if not isinstance(spec, dict):
        raise SpecError(path, "must be an object")
    unknown = set(spec) - set(_DEFAULTS)
    if unknown:
        raise SpecError(path, f"unknown keys {sorted(map(str, unknown))}")
    out = {**_DEFAULTS, **spec}
    if out["family"] != "layered":
        raise SpecError(f"{path}.family", "only the 'layered' family exists")
    out["rotation_axes"] = _axes(out["rotation_axes"], f"{path}.rotation_axes")
    for key, choices in (("entangler", ENTANGLER_KINDS), ("pattern", PATTERN_KINDS), ("brick_start", BRICK_STARTS)):
        if out[key] not in choices:
            raise SpecError(f"{path}.{key}", f"must be one of {', '.join(choices)}")
    out["layers"] = _layers(out["layers"], f"{path}.layers")
    out["rotations_per_qubit_per_layer"] = _int_in(
        out["rotations_per_qubit_per_layer"], 1, MAX_ROTATIONS, f"{path}.rotations_per_qubit_per_layer")
    out["variants"] = _int_in(out["variants"], 1, MAX_VARIANTS, f"{path}.variants")
    dress = out["clifford_dressing"]
    if isinstance(dress, bool) or not isinstance(dress, (int, float)) or not 0.0 <= dress <= 1.0:
        raise SpecError(f"{path}.clifford_dressing", "must be a probability between 0 and 1")
    out["clifford_dressing"] = float(dress)
    obs = out["observable"]
    if not isinstance(obs, str) or not obs.strip() or len(obs) > 400:
        raise SpecError(f"{path}.observable", "must be a non-empty string (preset or Pauli-sum spec)")
    try:
        parse_observable(resolve_observable(obs, 6), 6)
    except ObservableError as exc:
        raise SpecError(f"{path}.observable", f"{exc.message} (checked at n = 6)") from exc
    return out


# ---------------------------------------------------------------- structure
def _variant_structure(family: dict[str, Any], seed: int, variant: int) -> dict[str, Any]:
    """The n-independent random choices of one variant."""
    rng = random.Random(f"conjecture:{seed}:{variant}")
    lo, hi = family["layers"]
    layers = rng.randint(lo, hi)
    axes = family["rotation_axes"]
    if axes == "random_subset":
        axes = sorted(rng.sample(AXES, rng.randint(1, 3)))
    orders = []
    for _ in range(layers):
        order = list(axes)
        rng.shuffle(order)
        orders.append(order)
    start = {"even": 0, "odd": 1}.get(family["brick_start"])
    return {"layers": layers, "axes": list(axes), "orders": orders,
            "brick_start": rng.randint(0, 1) if start is None else start}


def _bonds(pattern: str, n: int, layer: int, start: int) -> list[tuple[int, int]]:
    if n < 2:
        return []
    if pattern == "brick":
        return [(i, i + 1) for i in range((start + layer) % 2, n - 1, 2)]
    if pattern == "ladder":
        return [(i, i + 1) for i in range(n - 1)]
    if pattern == "ring":
        return [(i, i + 1) for i in range(n - 1)] + ([(n - 1, 0)] if n > 2 else [])
    return [(i, j) for i in range(n) for j in range(i + 1, n)]


def _entangler_gates(kind: str, a: int, b: int) -> list[tuple[str, tuple[int, ...], tuple[float, ...]]]:
    if kind == "cz":
        return [("CZ", (a, b), ())]
    if kind == "cx":
        return [("CX", (a, b), ())]
    return [("CX", (a, b), ()), ("RZ", (b,), (math.pi / 2,)), ("CX", (a, b), ())]


def build_variant(family: dict[str, Any], n: int, seed: int, variant: int) -> tuple[ParamCircuit, dict[str, Any]]:
    """Build variant ``variant`` of a *normalized* ``family`` (see :func:`validate_family`) on ``n`` qubits.

    Returns ``(circuit, family_params)``.
    """
    if not 2 <= n <= 256:
        raise GrammarError(f"n = {n} is outside 2..256")
    st = _variant_structure(family, seed, variant)
    per_layer = len(_bonds(family["pattern"], n, 0, 0)) * (3 if family["entangler"] == "rzz_fixed" else 1)
    estimate = st["layers"] * (n * family["rotations_per_qubit_per_layer"] + per_layer)
    if estimate > MAX_GATES:
        raise GrammarError(f"family would need ~{estimate} gates at n = {n} (limit {MAX_GATES})")
    gates: list[IrGate] = []
    params: list[str] = []
    dressings = 0
    reps = family["rotations_per_qubit_per_layer"]
    for layer in range(st["layers"]):
        order = st["orders"][layer]
        for q in range(n):
            if family["clifford_dressing"] > 0:
                local = random.Random(f"conjecture:{seed}:{variant}:{layer}:{q}")
                if local.random() < family["clifford_dressing"]:
                    gates.append(IrGate(local.choice(DRESSINGS), (q,)))
                    dressings += 1
            for k in range(reps):
                name = f"t{len(params)}"
                params.append(name)
                gates.append(IrGate(f"R{order[k % len(order)]}", (q,), (ParamRef(name),)))
        if family["entangler"] != "none":
            for a, b in _bonds(family["pattern"], n, layer, st["brick_start"]):
                gates.extend(IrGate(g, qs, angles) for g, qs, angles in _entangler_gates(family["entangler"], a, b))
    circuit = ParamCircuit(n, [IrGate(g.name, g.qubits, g.angles, i) for i, g in enumerate(gates)], params, "native")
    info = {
        "variant": variant, "seed": seed, "n_qubits": n, "layers": st["layers"],
        "rotation_axes": st["axes"], "axis_order_per_layer": ["".join(o) for o in st["orders"]],
        "brick_start": st["brick_start"], "clifford_dressings": dressings,
        "entangler": family["entangler"], "pattern": family["pattern"],
        "rotations_per_qubit_per_layer": reps, "observable": family["observable"],
    }
    return circuit, info


def family_observable(family: dict[str, Any], n: int) -> PauliSum:
    """The family's observable at ``n`` qubits."""
    return parse_observable(resolve_observable(family["observable"], n), n)


def generate(
    family: dict[str, Any], n: int, seed: int, *, variants: int | None = None, start: int = 0,
    require_ppe: bool = False,
) -> list[tuple[str, ParamCircuit, dict[str, Any]]]:
    """Return ``[(variant_id, circuit, family_params)]`` for variants ``start .. start+variants-1``.

    Deterministic in ``(family, n, seed)``. ``variants`` defaults to the spec's own count. With
    ``require_ppe`` every circuit is checked with ``ppe_applicable`` and a failure raises
    :class:`GrammarError` (a grammar bug, never expected).
    """
    family = validate_family(family)
    count = family["variants"] if variants is None else variants
    out = []
    for v in range(start, start + count):
        circuit, info = build_variant(family, n, seed, v)
        if require_ppe:
            ok, reason = ppe_applicable(circuit, family_observable(family, n), init="uniform")
            if not ok:
                raise GrammarError(f"variant {v} is outside the PPE class: {reason}")
        out.append((f"v{v}", circuit, info))
    return out


def family_schema() -> dict[str, Any]:
    """JSON Schema of the family spec (what an LLM tool schema embeds)."""
    layer_int = {"type": "integer", "minimum": 1, "maximum": MAX_LAYERS}
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "TestFamily", "type": "object", "additionalProperties": False,
        "properties": {
            "family": {"const": "layered"},
            "rotation_axes": {"oneOf": [
                {"const": "random_subset"},
                {"type": "array", "items": {"enum": list(AXES)}, "minItems": 1, "maxItems": 3, "uniqueItems": True}]},
            "entangler": {"enum": list(ENTANGLER_KINDS), "default": "cz"},
            "pattern": {"enum": list(PATTERN_KINDS), "default": "brick"},
            "brick_start": {"enum": list(BRICK_STARTS), "default": "random"},
            "layers": {"oneOf": [layer_int, {"type": "array", "items": layer_int, "minItems": 2, "maxItems": 2}]},
            "rotations_per_qubit_per_layer": {"type": "integer", "minimum": 1, "maximum": MAX_ROTATIONS},
            "observable": {"type": "string", "description": "A preset (" + ", ".join(OBSERVABLE_PRESETS)
                           + ") or a Pauli-sum spec; {n}, {n-1}, {n+k} are substituted per qubit count."},
            "variants": {"type": "integer", "minimum": 1, "maximum": MAX_VARIANTS},
            "clifford_dressing": {"type": "number", "minimum": 0, "maximum": 1, "default": 0},
        },
    }
