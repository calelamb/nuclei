from __future__ import annotations

import pytest
import stim

from nuclei_mcp.errors import ToolInputError
from nuclei_mcp.server import build_server  # noqa: F401  (import smoke)
from nuclei_mcp.tools_inspect import inspect_circuit, read_circuit_text

SURFACE = str(stim.Circuit.generated("surface_code:rotated_memory_z", distance=3, rounds=3,
                                     after_clifford_depolarization=0.001))


def test_surface_code_counts_and_distance():
    r = inspect_circuit(SURFACE)
    ref = stim.Circuit(SURFACE)
    assert (r["num_qubits"], r["num_observables"]) == (ref.num_qubits, 1)
    assert r["num_measurements"] == ref.num_measurements
    assert r["num_detectors"] == 24
    assert r["graphlike_distance"] == 3
    assert len(r["circuit_sha256"]) == 64


def test_distance_scales_with_code_distance():
    text = str(stim.Circuit.generated("repetition_code:memory", distance=5, rounds=4, after_clifford_depolarization=0.01))
    assert inspect_circuit(text)["graphlike_distance"] == 5


def test_no_noise_gives_none_with_reason_and_explain_hook():
    text = str(stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3))
    r = inspect_circuit(text)
    assert r["graphlike_distance"] is None
    assert r["graphlike_distance_unavailable_reason"]
    assert r["nondeterministic_detector_explanation"] is None  # TODO hook, not implemented here


def test_invalid_circuit_rejected():
    with pytest.raises(ToolInputError, match="not a valid stim circuit"):
        inspect_circuit("NOT_A_GATE 0")


def test_exactly_one_source(tmp_path):
    with pytest.raises(ToolInputError, match="exactly one"):
        read_circuit_text(stim_text=None, path=None)
    with pytest.raises(ToolInputError, match="exactly one"):
        read_circuit_text(stim_text="H 0", path="x")
    with pytest.raises(ToolInputError, match="not found"):
        read_circuit_text(stim_text=None, path=str(tmp_path / "nope.stim"))
    with pytest.raises(ToolInputError, match="empty"):
        read_circuit_text(stim_text="  \n", path=None)


def test_path_input(tmp_path):
    p = tmp_path / "c.stim"
    p.write_text(SURFACE)
    assert read_circuit_text(stim_text=None, path=str(p)) == SURFACE


def test_circuit_hash_is_canonical_and_matches_campaign_tasks(tmp_path):
    import stim
    from nuclei_mcp.campaign_models import CampaignRequest
    from nuclei_mcp.campaign_tasks import build_tasks
    from nuclei_mcp.ceilings import Ceilings
    from nuclei_mcp.tools_inspect import inspect_circuit

    circuit = stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3, after_clifford_depolarization=0.05)
    path = tmp_path / "c.stim"
    path.write_text("# a comment that changes the raw text\n" + str(circuit))
    req = CampaignRequest.model_validate({
        "source": {"kind": "stim_paths", "paths": [str(path)], "rounds": 3, "noise_model": {"name": "n"}},
        "decoders": ["pymatching"], "max_shots": 10, "max_errors": 1, "max_seconds": 5, "max_tasks": 1})
    task_hash = build_tasks(req, Ceilings())[0].json_metadata["circuit_sha256"]
    assert inspect_circuit(path.read_text())["circuit_sha256"] == task_hash


def test_huge_circuit_skips_the_synchronous_distance_search(monkeypatch):
    import nuclei_mcp.tools_inspect as ti
    monkeypatch.setattr(ti, "MAX_DISTANCE_DETECTORS", 0)
    out = ti.inspect_circuit("R 0 1\nM 0 1\nDETECTOR rec[-1] rec[-2]\nOBSERVABLE_INCLUDE(0) rec[-1]")
    assert out["graphlike_distance"] is None and "skipped" in out["graphlike_distance_unavailable_reason"]


def test_invalid_circuit_error_never_echoes_file_content(tmp_path):
    secret = "SUPERSECRETTOKEN1234 and more"
    p = tmp_path / "notes.txt"
    p.write_text(secret)
    text = read_circuit_text(stim_text=None, path=str(p))
    with pytest.raises(ToolInputError) as info:
        inspect_circuit(text)
    assert "SUPERSECRETTOKEN1234" not in str(info.value)
    assert "not a valid stim circuit" in str(info.value)


def test_non_utf8_file_error_has_no_bytes_and_keeps_path(tmp_path):
    p = tmp_path / "bin.stim"
    p.write_bytes(b"\xff\xfeSECRET\x80")
    with pytest.raises(ToolInputError) as info:
        read_circuit_text(stim_text=None, path=str(p))
    assert str(p) in str(info.value)
    assert "SECRET" not in str(info.value)


def test_symlink_is_refused_even_when_target_is_a_circuit(tmp_path):
    real = tmp_path / "real.stim"
    real.write_text(SURFACE)
    link = tmp_path / "link.stim"
    link.symlink_to(real)
    with pytest.raises(ToolInputError, match="symlink") as info:
        read_circuit_text(stim_text=None, path=str(link))
    assert str(link) in str(info.value)


def test_directory_and_fifo_are_refused_as_non_regular(tmp_path):
    import os
    with pytest.raises(ToolInputError, match="regular file") as info:
        read_circuit_text(stim_text=None, path=str(tmp_path))
    assert str(tmp_path) in str(info.value)
    fifo = tmp_path / "pipe.stim"
    os.mkfifo(fifo)
    with pytest.raises(ToolInputError, match="regular file"):
        read_circuit_text(stim_text=None, path=str(fifo))


def test_oversized_file_is_refused_with_path(tmp_path, monkeypatch):
    import nuclei_mcp.tools_inspect as ti
    monkeypatch.setattr(ti, "MAX_CIRCUIT_BYTES", 4)
    p = tmp_path / "big.stim"
    p.write_text("H 0\nH 0\n")
    with pytest.raises(ToolInputError, match="exceeds"):
        ti.read_circuit_text(stim_text=None, path=str(p))
