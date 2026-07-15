"""Tests for PRD 10 Phase A — the Stim adapter, `.stim` source routing,
`qec_generate`, and the `qec_snapshot` DEM payload with its caps.

Ground-truth DEM numbers were computed with stim 1.16.0 and are stable for
the pinned range (they follow from the generated circuits' structure, not
from sampling): a change here on a stim upgrade is a real behavioral
change to investigate, not test flakiness.
"""

from __future__ import annotations

import pytest

pytest.importorskip("stim")
import stim  # noqa: E402

from kernel.adapters.stim_adapter import StimAdapter  # noqa: E402
from kernel.executor import Executor  # noqa: E402
from kernel.qec.dem import build_qec_payload  # noqa: E402
from kernel.qec.generate import QecGenerateError, generate_circuit  # noqa: E402

REPETITION_PY = """\
import stim

circuit = stim.Circuit.generated(
    "repetition_code:memory", distance=3, rounds=3,
    after_clifford_depolarization=0.001,
    before_measure_flip_probability=0.001,
)
"""

SURFACE_D3 = stim.Circuit.generated(
    "surface_code:rotated_memory_z",
    distance=3,
    rounds=3,
    after_clifford_depolarization=0.001,
    before_measure_flip_probability=0.001,
)

HANDWRITTEN_STIM = """\
H 0
CX 0 1 2 3
X_ERROR(0.01) 0 1
TICK
M 0 1
DETECTOR(1, 0) rec[-1] rec[-2]
OBSERVABLE_INCLUDE(0) rec[-1]
"""


# ───────── snapshot mapping (moment/TICK layout) ─────────


def test_handwritten_snapshot_moment_layout_and_gate_mapping():
    adapter = StimAdapter()
    snapshot = adapter.extract_snapshot(stim.Circuit(HANDWRITTEN_STIM))

    assert snapshot.framework == "stim"
    assert snapshot.qubit_count == 4
    assert snapshot.classical_bit_count == 2  # measurement records

    by_type = {}
    for g in snapshot.gates:
        by_type.setdefault(g.type, []).append(g)

    # "CX 0 1 2 3" splits into two CNOTs, control first in each pair.
    cnots = by_type["CNOT"]
    assert [(g.controls, g.targets) for g in cnots] == [([0], [1]), ([2], [3])]

    # Noise ops become NOISE:<kind> with the probability in params, one
    # gate per qubit for single-qubit channels.
    noise = by_type["NOISE:X_ERROR"]
    assert [g.targets for g in noise] == [[0], [1]]
    assert all(g.params == [0.01] for g in noise)

    # TICK drives layers: everything before it is moment 0, after it 1.
    assert all(g.layer == 0 for g in cnots + noise + by_type["H"])
    assert all(g.layer == 1 for g in by_type["Measure"])

    # DETECTOR/OBSERVABLE_INCLUDE become markers anchored to their moment,
    # carrying their argument lists (coords / observable index) in params.
    assert by_type["DETECTOR"][0].layer == 1
    assert by_type["DETECTOR"][0].params == [1.0, 0.0]
    assert by_type["OBSERVABLE"][0].params == [0.0]

    assert snapshot.depth == 2


def test_repetition_code_snapshot_counts_match_stim():
    adapter = StimAdapter()
    circuit = stim.Circuit.generated(
        "repetition_code:memory", distance=3, rounds=3,
        after_clifford_depolarization=0.001,
        before_measure_flip_probability=0.001,
    )
    snapshot = adapter.extract_snapshot(circuit)

    assert snapshot.qubit_count == circuit.num_qubits == 5
    assert snapshot.classical_bit_count == circuit.num_measurements
    detector_markers = [g for g in snapshot.gates if g.type == "DETECTOR"]
    observable_markers = [g for g in snapshot.gates if g.type == "OBSERVABLE"]
    assert len(detector_markers) == circuit.num_detectors == 8
    assert len(observable_markers) == circuit.num_observables == 1
    # Moment layout: layers never exceed the tick count.
    assert max(g.layer for g in snapshot.gates) <= circuit.num_ticks
    assert any(g.type.startswith("NOISE:") for g in snapshot.gates)


def test_rotated_surface_code_snapshot_maps_without_unknown_leakage():
    adapter = StimAdapter()
    snapshot = adapter.extract_snapshot(SURFACE_D3)

    assert snapshot.qubit_count == 26
    types = {g.type for g in snapshot.gates}
    # The generated circuit uses exactly these mapped families.
    assert types <= {
        "H", "CNOT", "Measure", "Reset", "MR", "DETECTOR", "OBSERVABLE",
        "NOISE:DEPOLARIZE1", "NOISE:DEPOLARIZE2", "NOISE:X_ERROR",
    }
    # Every 2-qubit gate is a proper pair, never a packed multi-target blob.
    for g in snapshot.gates:
        if g.type == "CNOT":
            assert len(g.controls) == 1 and len(g.targets) == 1
        if g.type == "NOISE:DEPOLARIZE2":
            assert len(g.targets) == 2


# ───────── DEM payload: known values, merging, truncation ─────────


def test_dem_counts_repetition_d3_r3():
    circuit = stim.Circuit.generated(
        "repetition_code:memory", distance=3, rounds=3,
        after_clifford_depolarization=0.001,
        before_measure_flip_probability=0.001,
    )
    payload = build_qec_payload(circuit)

    assert payload["num_qubits"] == 5
    assert payload["num_detectors"] == 8
    assert payload["num_observables"] == 1
    assert payload["num_ticks"] == 9
    dem = payload["dem"]
    assert dem["nodes"] == 8
    assert dem["edge_count"] == len(dem["edges"]) == 13
    assert dem["boundary_edge_count"] == len(dem["boundary_edges"]) == 8
    assert dem["hyperedges_count"] == 0
    assert dem["truncated"] is False
    # Edges are merged: no duplicate detector pairs survive.
    pairs = [(e["d1"], e["d2"]) for e in dem["edges"]]
    assert len(pairs) == len(set(pairs))
    assert all(0.0 < e["p"] < 1.0 for e in dem["edges"])


def test_dem_counts_rotated_surface_d3_r3():
    payload = build_qec_payload(SURFACE_D3)

    assert payload["num_detectors"] == 24
    dem = payload["dem"]
    assert dem["nodes"] == 24
    assert dem["edge_count"] == 54
    assert dem["boundary_edge_count"] == 24
    assert dem["hyperedges_count"] == 0


def test_dem_truncation_sends_summary_only_and_flags_it():
    payload = build_qec_payload(SURFACE_D3, max_edges=10)

    dem = payload["dem"]
    assert dem["truncated"] is True
    assert dem["edges"] == []
    assert dem["boundary_edges"] == []
    # Summary counts survive truncation — never silent.
    assert dem["edge_count"] == 54
    assert dem["boundary_edge_count"] == 24


def test_dem_hyperedge_fallback_reports_honestly():
    # Three detectors fired by one error can't decompose into graphlike
    # components: decompose_errors=True raises, the fallback keeps the
    # undecomposed model and reports the hyperedge count instead of dying.
    circuit = stim.Circuit(
        """
        X_ERROR(0.1) 0
        M 0
        DETECTOR rec[-1]
        DETECTOR rec[-1]
        DETECTOR rec[-1]
        """
    )
    payload = build_qec_payload(circuit)

    assert payload["dem"]["hyperedges_count"] == 1
    assert payload["dem"]["edges"] == []


def _extract_detector_graph_by_object_walk(dem, max_edges: int) -> dict:
    """Reference implementation: the pre-optimization form that walks the live
    DEM object target-by-target. Kept in the test only, to pin that the fast
    text-parse `extract_detector_graph` stays byte-identical to it."""
    from kernel.qec.dem import _xor_combine

    edges: dict = {}
    boundary: dict = {}
    hyperedges = 0

    def _add(store, key, p, obs):
        if key in store:
            old_p, old_obs = store[key]
            store[key] = (_xor_combine(old_p, p), old_obs | obs)
        else:
            store[key] = (p, obs)

    for inst in dem.flattened():
        if inst.type != "error":
            continue
        p = float(inst.args_copy()[0])
        components: list[list] = [[]]
        for t in inst.targets_copy():
            if t.is_separator():
                components.append([])
            else:
                components[-1].append(t)
        for component in components:
            dets = sorted(t.val for t in component if t.is_relative_detector_id())
            obs = frozenset(t.val for t in component if t.is_logical_observable_id())
            if len(dets) == 2:
                _add(edges, (dets[0], dets[1]), p, obs)
            elif len(dets) == 1:
                _add(boundary, dets[0], p, obs)
            elif len(dets) > 2:
                hyperedges += 1

    total = len(edges) + len(boundary)
    payload: dict = {
        "nodes": dem.num_detectors,
        "edge_count": len(edges),
        "boundary_edge_count": len(boundary),
        "hyperedges_count": hyperedges,
        "truncated": total > max_edges,
    }
    if total > max_edges:
        payload["edges"] = []
        payload["boundary_edges"] = []
    else:
        payload["edges"] = [
            {"d1": d1, "d2": d2, "obs": sorted(obs), "p": round(p, 12)}
            for (d1, d2), (p, obs) in sorted(edges.items())
        ]
        payload["boundary_edges"] = [
            {"d": d, "obs": sorted(obs), "p": round(p, 12)}
            for d, (p, obs) in sorted(boundary.items())
        ]
    return payload


@pytest.mark.parametrize(
    "code,kw",
    [
        ("surface_code:rotated_memory_z", dict(distance=3, rounds=3)),
        ("surface_code:rotated_memory_z", dict(distance=5, rounds=5)),
        ("repetition_code:memory", dict(distance=9, rounds=9)),
    ],
)
def test_dem_text_parse_matches_object_walk(code, kw):
    from kernel.qec.dem import extract_detector_graph

    circuit = stim.Circuit.generated(
        code,
        after_clifford_depolarization=0.01,
        before_measure_flip_probability=0.01,
        after_reset_flip_probability=0.01,
        **kw,
    )
    dem = circuit.detector_error_model(decompose_errors=True)
    fast = extract_detector_graph(dem, max_edges=200_000)
    reference = _extract_detector_graph_by_object_walk(dem, max_edges=200_000)
    assert fast == reference


def test_coords_are_padded_aligned_arrays():
    payload = build_qec_payload(SURFACE_D3)
    coords = payload["coords"]

    assert len(coords["qubits"]) == 26
    assert len(coords["detectors"]) == 24
    # Generated surface codes have coordinates for every qubit except any
    # unused index padding; present entries are [x, y] pairs.
    present = [c for c in coords["qubits"] if c is not None]
    assert present and all(len(c) == 2 for c in present)
    assert all(c is None or len(c) == 3 for c in coords["detectors"])


# ───────── seeded sampling determinism ─────────


def test_same_seed_twice_yields_identical_measurements():
    adapter = StimAdapter()
    circuit = stim.Circuit.generated(
        "repetition_code:memory", distance=3, rounds=3,
        before_measure_flip_probability=0.05,
    )
    a = adapter.simulate(circuit, 128, seed=7)
    b = adapter.simulate(circuit, 128, seed=7)

    assert a.measurements == b.measurements
    assert a.seed_honored is True
    assert sum(a.measurements.values()) == 128


def test_different_seeds_usually_yield_different_measurements():
    adapter = StimAdapter()
    circuit = stim.Circuit.generated(
        "repetition_code:memory", distance=3, rounds=3,
        before_measure_flip_probability=0.05,
    )
    a = adapter.simulate(circuit, 256, seed=1)
    b = adapter.simulate(circuit, 256, seed=2)

    assert a.measurements != b.measurements


def test_unseeded_simulation_omits_seed_honored():
    adapter = StimAdapter()
    result = adapter.simulate(stim.Circuit("H 0\nM 0"), 16)

    assert result.seed_honored is None
    assert "seed_honored" not in result.to_dict()
    # Stabilizer honesty: no fake statevector/Bloch output.
    assert result.state_vector == []
    assert result.bloch_coords == []


# ───────── executor routing: python mode + raw .stim source ─────────


def test_python_stim_code_detected_and_executed():
    executor = Executor()
    result, snapshot, _stdout, _stderr, error = executor.execute(
        REPETITION_PY, 64, language="python", seed=11
    )

    assert error is None
    assert snapshot is not None and snapshot.framework == "stim"
    assert result is not None
    assert sum(result.measurements.values()) == 64
    assert result.seed_honored is True


def test_raw_stim_source_executes_without_python_exec():
    executor = Executor()
    result, snapshot, stdout, stderr, error = executor.execute(
        HANDWRITTEN_STIM, 32, language="stim", seed=3
    )

    assert error is None
    assert stdout == "" and stderr == ""
    assert snapshot is not None and snapshot.framework == "stim"
    assert sum(result.measurements.values()) == 32


def test_raw_stim_syntax_error_is_compile_error():
    executor = Executor()
    result, snapshot, _stdout, _stderr, error = executor.execute(
        "NOT_A_REAL_INSTRUCTION 0", 8, language="stim"
    )

    assert result is None and snapshot is None
    assert error is not None and error.code == "compile_error"
    assert error.framework == "stim"


def test_raw_stim_rejects_params():
    executor = Executor()
    *_, error = executor.execute(
        HANDWRITTEN_STIM, 8, language="stim", params={"theta": 1.0}
    )

    assert error is not None and error.code == "compile_error"
    assert "params" in error.message


def test_missing_stim_degrades_to_missing_dependency(monkeypatch):
    import importlib

    real_import = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "kernel.adapters.stim_adapter":
            raise ImportError("No module named 'stim'", name="stim")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("kernel.executor.importlib.import_module", fake_import)
    executor = Executor()
    *_, error = executor.execute("H 0\nM 0", 8, language="stim")

    assert error is not None
    assert error.code == "missing_dependency"
    assert error.dependency == "stim"
    assert "Stim" in error.message


# ───────── qec_snapshot payload via the executor (cache + stateless) ─────────


def test_qec_snapshot_uses_cached_circuit_after_execute():
    executor = Executor()
    executor.execute(REPETITION_PY, 16, language="python")

    payload, error = executor.qec_snapshot_payload()

    assert error is None
    assert payload["num_detectors"] == 8
    assert payload["dem"]["edge_count"] == 13


def test_qec_snapshot_recompute_with_higher_cap_after_truncation():
    executor = Executor()
    executor.execute(str(SURFACE_D3), 1, language="stim")

    truncated, _ = executor.qec_snapshot_payload(max_edges=10)
    full, _ = executor.qec_snapshot_payload(max_edges=10_000)

    assert truncated["dem"]["truncated"] is True and truncated["dem"]["edges"] == []
    assert full["dem"]["truncated"] is False and len(full["dem"]["edges"]) == 54


def test_qec_snapshot_stateless_form_with_code():
    executor = Executor()
    payload, error = executor.qec_snapshot_payload(
        code="X_ERROR(0.1) 0\nM 0 1\nDETECTOR rec[-1] rec[-2]", language="stim"
    )

    assert error is None
    assert payload["num_qubits"] == 2
    assert payload["num_detectors"] == 1
    assert payload["dem"]["boundary_edge_count"] == 1


def test_qec_snapshot_degrades_when_no_dem_exists():
    # HANDWRITTEN_STIM measures a superposition, so its observable is not
    # deterministic and stim refuses to build ANY detector error model.
    # The payload must still carry circuit stats, with dem null + a reason.
    executor = Executor()
    payload, error = executor.qec_snapshot_payload(
        code=HANDWRITTEN_STIM, language="stim"
    )

    assert error is None
    assert payload["num_qubits"] == 4
    assert payload["dem"] is None
    assert payload["dem_error"]


def test_qec_snapshot_without_any_circuit_is_no_circuit_error():
    payload, error = Executor().qec_snapshot_payload()

    assert payload is None
    assert error is not None and error.code == "no_circuit"


def test_qec_snapshot_rejects_non_stim_code():
    payload, error = Executor().qec_snapshot_payload(
        code="from qiskit import QuantumCircuit", language="python"
    )

    assert payload is None
    assert error is not None and error.code == "unsupported_framework"


# ───────── qec_generate ─────────


def test_qec_generate_returns_parseable_stim_text():
    text = generate_circuit(
        "repetition_code:memory", 3, 2,
        {"before_measure_flip_probability": 0.01},
    )

    circuit = stim.Circuit(text)
    assert circuit.num_qubits == 5
    assert "X_ERROR(0.01)" in text


def test_qec_generate_unknown_code_names_the_options():
    with pytest.raises(QecGenerateError) as excinfo:
        generate_circuit("steane_code:memory", 3, 3)

    assert "repetition_code:memory" in str(excinfo.value)


@pytest.mark.parametrize(
    ("distance", "rounds", "noise"),
    [
        (1, 3, None),
        (3, 0, None),
        (3, 3, {"bogus_knob": 0.1}),
        (3, 3, {"before_measure_flip_probability": 1.5}),
    ],
)
def test_qec_generate_validation_errors_are_user_readable(distance, rounds, noise):
    with pytest.raises(QecGenerateError) as excinfo:
        generate_circuit("repetition_code:memory", distance, rounds, noise)

    message = str(excinfo.value)
    assert message and "Traceback" not in message
