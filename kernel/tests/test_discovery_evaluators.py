"""Registry, EvaluatorSpec shape, config validation and fingerprints."""

from __future__ import annotations

import json

import pytest

from kernel.discovery.evaluators import EVALUATORS, InvalidConfig, effective_config, fingerprint, normalize_config
from kernel.discovery.evaluators import base

SPEC = EVALUATORS["qec_memory"]


def test_registry_has_qec_memory_with_spec_fields():
    shape = SPEC.to_json()
    assert set(shape) >= {
        "kind", "version", "title", "description", "task", "entry_signature",
        "objectives", "descriptors", "config_schema", "default_config",
    }
    assert shape["kind"] == "qec_memory" and shape["task"] == "stim_circuit"
    assert [o["key"] for o in shape["objectives"]] == ["logical_error_per_round", "qubits"]
    assert [d["key"] for d in shape["descriptors"]] == ["qubits", "two_qubit_gates_per_round"]
    json.dumps(shape)  # wire-serializable


def test_to_json_is_a_copy():
    shape = SPEC.to_json()
    shape["default_config"]["distances"].append(99)
    assert SPEC.default_config["distances"] == [3, 5]


def test_defaults_fill_and_validate():
    config = normalize_config(SPEC, {})
    assert config["distances"] == [3, 5] and config["rounds"] == "d"
    assert config["noise"]["model"] == "uniform" and config["noise"]["p"] == 1e-3
    partial = normalize_config(SPEC, {"noise": {"model": "si1000"}})
    assert partial["noise"] == {"model": "si1000", "p": 1e-3, "bias": 10}


@pytest.mark.parametrize(
    "bad",
    [
        {"distances": [1, 3]}, {"distances": [3, 5, 7, 9, 11]}, {"distances": [5, 3]}, {"distances": [3, 3]},
        {"rounds": "x"}, {"rounds": 0}, {"noise": {"model": "mystery"}}, {"noise": {"p": 0.5}},
        {"noise": {"p": 1e-6}}, {"decoder": "bp"}, {"shots": {"min": 5000, "max": 1000}},
        {"unknown_key": 1}, {"max_qubits": "many"}, "not-an-object",
    ],
)
def test_invalid_configs_raise(bad):
    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, bad)


def test_hand_validator_agrees_with_jsonschema_on_samples():
    good = normalize_config(SPEC, {})
    base.validate_by_hand(SPEC.config_schema, good)
    for bad in ({"distances": [1]}, {"rounds": "x"}, {"noise": {"model": "zzz"}}, {"nope": 1}):
        merged = base.deep_merge(good, bad)
        with pytest.raises(InvalidConfig):
            base.validate_by_hand(SPEC.config_schema, merged)
        with pytest.raises(InvalidConfig):
            base.validate_schema(SPEC.config_schema, merged)


def test_validation_works_without_jsonschema(monkeypatch):
    monkeypatch.setattr(base, "jsonschema", None)
    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, {"distances": [1]})
    assert normalize_config(SPEC, {})["distances"] == [3, 5]


def test_stage_overrides_merge_without_mutating():
    config = normalize_config(SPEC, {})
    screen = effective_config(SPEC, config, "screen")
    assert screen["shots"] == {"min": 1000, "max": 5000, "max_errors": 50}
    assert config["shots"]["max"] == 200000
    assert effective_config(SPEC, config, "full") == config
    with pytest.raises(InvalidConfig):
        effective_config(SPEC, config, "bogus")


def test_calls_follow_rounds_setting():
    assert SPEC.calls(normalize_config(SPEC, {})) == [
        {"args": [3, 3], "kwargs": {}}, {"args": [5, 5], "kwargs": {}},
    ]
    assert SPEC.calls(normalize_config(SPEC, {"rounds": 4, "distances": [3]})) == [{"args": [3, 4], "kwargs": {}}]


def test_fingerprint_is_full_hex_and_tracks_config():
    config = normalize_config(SPEC, {})
    fp = fingerprint("qec_memory", config)
    assert len(fp) == 64 and int(fp, 16) >= 0
    assert fingerprint("qec_memory", config) == fp
    changed = normalize_config(SPEC, {"noise": {"p": 2e-3}})
    assert fingerprint("qec_memory", changed) != fp


def test_fingerprint_covers_evaluator_and_imported_discovery_modules():
    closure = base.source_closure("kernel.discovery.evaluators.qec_memory")
    for module in (
        "kernel.discovery.evaluators.qec_memory",
        "kernel.discovery.evaluators.base",
        "kernel.discovery.evaluators.qec_guardrails",
        "kernel.discovery.evaluators.qec_stats",
        "kernel.discovery.noise",
        "kernel.discovery.cost",
        "kernel.discovery.distance",
    ):
        assert module in closure, module
    assert "kernel.discovery.sandbox" not in closure
    assert not any(name.endswith("__init__") for name in closure)


def test_fingerprint_changes_when_a_dependency_source_changes(monkeypatch):
    config = normalize_config(SPEC, {})
    before = fingerprint("qec_memory", config)
    real = base.source_closure

    def tampered(name):
        out = dict(real(name))
        out["kernel.discovery.noise"] = out["kernel.discovery.noise"] + b"# edit"
        return out

    monkeypatch.setattr(base, "source_closure", tampered)
    monkeypatch.setattr(base, "_closure_cache", {})
    assert fingerprint("qec_memory", config) != before
