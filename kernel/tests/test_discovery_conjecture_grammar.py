"""Grammar (test-family generator) and predicate-language tests for the Conjecture Engine."""

from __future__ import annotations

import pytest

from kernel.discovery.conjecture import grammar, predicate
from kernel.discovery.conjecture.errors import SpecError
from kernel.discovery.features import extract_features
from kernel.trainability.ir import ParamCircuit, ir_hash
from kernel.trainability.pauliprop import ppe_applicable


def family(**overrides) -> dict:
    return grammar.validate_family({"rotation_axes": ["Y", "Z"], "layers": [1, 3],
                                    "rotations_per_qubit_per_layer": 2, "variants": 6, **overrides})


# ------------------------------------------------------------------ grammar
def test_generation_is_deterministic_and_seed_sensitive():
    a = grammar.generate(family(), 8, seed=11)
    b = grammar.generate(family(), 8, seed=11)
    c = grammar.generate(family(), 8, seed=12)
    assert [(v, ir_hash(x), p) for v, x, p in a] == [(v, ir_hash(x), p) for v, x, p in b]
    assert [ir_hash(x) for _, x, _ in a] != [ir_hash(x) for _, x, _ in c]
    assert [v for v, _, _ in a] == [f"v{i}" for i in range(6)]


def test_variants_are_random_within_the_family_dofs():
    infos = [info for _, _, info in grammar.generate(family(variants=16), 8, seed=3)]
    assert {i["layers"] for i in infos} == {1, 2, 3}
    assert len({tuple(i["axis_order_per_layer"]) for i in infos}) > 3
    assert {i["brick_start"] for i in infos} == {0, 1}


def test_a_variant_is_the_same_family_member_at_every_qubit_count():
    small = grammar.build_variant(family(clifford_dressing=0.4), 6, 5, 2)[1]
    large = grammar.build_variant(family(clifford_dressing=0.4), 24, 5, 2)[1]
    for key in ("layers", "axis_order_per_layer", "brick_start", "rotation_axes"):
        assert small[key] == large[key]


@pytest.mark.parametrize("entangler", ["cz", "cx", "rzz_fixed", "none"])
@pytest.mark.parametrize("pattern", ["brick", "ladder", "ring", "all_to_all"])
def test_every_generated_circuit_satisfies_ppe_applicable(entangler, pattern):
    spec = family(entangler=entangler, pattern=pattern, clifford_dressing=0.5, rotation_axes="random_subset",
                  observable="preset:zz_chain")
    for n in (2, 5, 9):
        for _, circuit, _ in grammar.generate(spec, n, seed=9, require_ppe=True):
            assert ppe_applicable(circuit, grammar.family_observable(spec, n), init="uniform")[0]
            assert len(set(circuit.parameters)) == len(circuit.parameters)


def test_brick_start_even_is_classified_as_brick_by_the_feature_extractor():
    spec = family(brick_start="even")
    for _, circuit, info in grammar.generate(spec, 10, seed=1):
        assert extract_features(circuit, n_layers=info["layers"])["entangler_pattern"] == "brick"
    spec = family(pattern="ladder")
    _, circuit, info = grammar.generate(spec, 10, seed=1)[0]
    assert extract_features(circuit, n_layers=info["layers"])["entangler_pattern"] == "ladder"


def test_circuits_round_trip_through_the_ir_json():
    _, circuit, _ = grammar.generate(family(clifford_dressing=0.5), 7, seed=2)[0]
    assert ir_hash(ParamCircuit.from_json(circuit.to_json())) == ir_hash(circuit)


def test_observable_templating():
    spec = family(observable="Z0*Z{n-1} + 0.5*X{n-2}")
    assert grammar.resolve_observable(spec["observable"], 8) == "Z0*Z7 + 0.5*X6"
    assert grammar.family_observable(spec, 8).max_qubit() == 7


def test_oversized_family_is_refused_not_generated():
    spec = family(pattern="all_to_all", layers=[32, 32])
    with pytest.raises(grammar.GrammarError):
        grammar.build_variant(spec, 128, 0, 0)


@pytest.mark.parametrize("bad,path", [
    ({"family": "wide"}, "test_family.family"),
    ({"rotation_axes": ["Q"]}, "test_family.rotation_axes[0]"),
    ({"layers": [3, 1]}, "test_family.layers"),
    ({"layers": 99}, "test_family.layers"),
    ({"pattern": "star"}, "test_family.pattern"),
    ({"variants": 0}, "test_family.variants"),
    ({"observable": "Z99999999*"}, "test_family.observable"),
    ({"clifford_dressing": 2}, "test_family.clifford_dressing"),
    ({"surprise": 1}, "test_family"),
])
def test_invalid_family_specs_carry_a_path(bad, path):
    with pytest.raises(SpecError) as info:
        grammar.validate_family({"rotation_axes": ["Y"], **bad})
    assert info.value.path == path


# ---------------------------------------------------------------- predicate
FEATURES = {"n_layers": 2, "entangler_pattern": "brick", "entangler": "cz", "rotation_axes": "YZ",
            "params_per_qubit": 4.0, "rotation_axis_counts": {"Y": 8, "Z": 8}, "two_qubit_gates": 12}


def leaf(feature, op, value):
    return {"feature": feature, "op": op, "value": value}


def test_valid_predicates_evaluate():
    assert predicate.evaluate(None, FEATURES)
    assert predicate.evaluate(leaf("n_layers", "<=", 2), FEATURES)
    assert not predicate.evaluate(leaf("n_layers", ">", 2), FEATURES)
    assert predicate.evaluate(leaf("entangler_pattern", "in", ["ring", "brick"]), FEATURES)
    assert predicate.evaluate(leaf("rotation_axis_counts.Y", ">=", 8), FEATURES)
    assert predicate.evaluate(leaf("rotation_axis_counts.X", "==", 0), FEATURES)
    assert not predicate.evaluate(leaf("two_qubit_gates_per_layer", ">", 0), FEATURES)  # absent feature


def test_nesting_all_any():
    nested = {"all": [leaf("entangler", "==", "cz"),
                      {"any": [leaf("n_layers", ">", 5), {"all": [leaf("rotation_axes", "==", "YZ"),
                                                                  leaf("params_per_qubit", ">=", 4)]}]}]}
    assert predicate.evaluate(nested, FEATURES)
    nested["all"][1]["any"][1]["all"][1]["value"] = 5
    assert not predicate.evaluate(nested, FEATURES)


@pytest.mark.parametrize("bad,path", [
    ({"all": []}, "feature_predicate.all"),
    ({"all": [leaf("n_layers", "<", 1), {"any": [leaf("n_layers", "~", 1)]}]}, "feature_predicate.all[1].any[0].op"),
    ({"all": [leaf("nope", "<", 1)]}, "feature_predicate.all[0].feature"),
    (leaf("entangler_pattern", "<", "brick"), "feature_predicate.op"),
    (leaf("entangler_pattern", "==", "hexagon"), "feature_predicate.value"),
    (leaf("n_layers", "==", "two"), "feature_predicate.value"),
    (leaf("n_layers", "in", 3), "feature_predicate.value"),
    (leaf("n_layers", "in", [1, "x"]), "feature_predicate.value[1]"),
    ({"feature": "n_layers", "op": "<"}, "feature_predicate.value"),
    ({"all": [leaf("n_layers", "<", 1)], "any": []}, "feature_predicate"),
    ({"feature": "n_layers", "op": "<", "value": 1, "extra": 1}, "feature_predicate"),
    ("n_layers < 3", "feature_predicate"),
])
def test_invalid_predicates_report_the_path(bad, path):
    with pytest.raises(SpecError) as info:
        predicate.validate(bad)
    assert info.value.path == path


@pytest.mark.parametrize("name", [
    "__class__", "__class__.__mro__", "n_layers.__class__", "__import__('os').system('echo pwned')",
    "n_layers; import os", "rotation_axis_counts.__class__", "rotation_axis_counts.", "eval", "",
])
def test_injection_attempts_in_feature_names_are_rejected(name):
    with pytest.raises(SpecError) as info:
        predicate.evaluate(leaf(name, "==", 1), FEATURES)
    assert info.value.path.endswith(".feature")


@pytest.mark.parametrize("op", ["__eq__", "eval", "==; 1", "is", "lambda", None, 3])
def test_injection_attempts_in_operators_are_rejected(op):
    with pytest.raises(SpecError):
        predicate.evaluate(leaf("n_layers", op, 1), FEATURES)


def test_code_in_values_is_only_ever_data():
    with pytest.raises(SpecError):
        predicate.evaluate(leaf("entangler", "==", "__import__('os').system('x')"), FEATURES)
    with pytest.raises(SpecError):
        predicate.evaluate(leaf("n_layers", "==", "__import__('os')"), FEATURES)


def test_depth_and_size_limits():
    deep: dict = leaf("n_layers", ">", 0)
    for _ in range(predicate.MAX_DEPTH + 1):
        deep = {"all": [deep]}
    with pytest.raises(SpecError, match="deeper"):
        predicate.validate(deep)
    wide = {"any": [leaf("n_layers", ">", i) for i in range(predicate.MAX_NODES + 1)]}
    with pytest.raises(SpecError, match="nodes"):
        predicate.validate(wide)


def test_predicate_schema_lists_every_feature():
    enum = predicate.predicate_schema()["$defs"]["leaf"]["properties"]["feature"]["enum"]
    assert set(enum) == set(predicate.FEATURES)
