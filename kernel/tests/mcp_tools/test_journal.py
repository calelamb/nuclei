from __future__ import annotations

import json
import os
import stat

import pytest

from nuclei_mcp import journal as journal_module
from nuclei_mcp.errors import JournalError, ToolInputError
from nuclei_mcp.journal import Journal


def _append(j: Journal, **kw):
    return j.append(tool="t", inputs={"a": 1}, outputs={"v": 2}, manifest={"m": 3}, parent_run_ids=kw.get("parents", []))


def test_roundtrip_and_fields(tmp_path):
    j = Journal(tmp_path)
    rec = _append(j)
    got = j.get(rec["run_id"])
    assert got == rec
    assert got["inputs"] == {"a": 1} and got["outputs"] == {"v": 2} and got["manifest"] == {"m": 3}
    assert got["rerun"] == {"tool": "t", "arguments": {"a": 1}}


def test_records_are_write_once(tmp_path, monkeypatch):
    j = Journal(tmp_path)
    monkeypatch.setattr(journal_module, "_new_run_id", lambda now: "run-20260101T000000Z-deadbeef")
    _append(j)
    with pytest.raises(JournalError, match="write-once"):
        _append(j)
    assert j.get("run-20260101T000000Z-deadbeef")["outputs"] == {"v": 2}


def test_record_file_is_read_only(tmp_path):
    rec = _append(Journal(tmp_path))
    path = tmp_path / "runs" / f"{rec['run_id']}.json"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o444


def test_no_mutating_api():
    public = {n for n in dir(Journal) if not n.startswith("_")}
    assert public == {"append", "get", "list", "root", "write_artifact"}


def test_tampering_is_detected(tmp_path):
    j = Journal(tmp_path)
    rec = _append(j)
    path = tmp_path / "runs" / f"{rec['run_id']}.json"
    os.chmod(path, 0o644)
    data = json.loads(path.read_text())
    data["outputs"]["v"] = 999
    path.write_text(json.dumps(data))
    with pytest.raises(JournalError, match="integrity"):
        j.get(rec["run_id"])


@pytest.mark.parametrize("bad", ["../etc/passwd", "run-1", "", "run-20260101T000000Z-DEADBEEF", "x" * 400])
def test_run_id_validation_blocks_traversal(tmp_path, bad):
    with pytest.raises(ToolInputError):
        Journal(tmp_path).get(bad)


def test_missing_record_and_missing_parent(tmp_path):
    j = Journal(tmp_path)
    with pytest.raises(ToolInputError, match="no journal record"):
        j.get("run-20260101T000000Z-00000000")
    with pytest.raises(ToolInputError):
        _append(j, parents=["run-20260101T000000Z-00000000"])


def test_list_newest_first_with_filter_and_limit(tmp_path):
    j = Journal(tmp_path)
    a = _append(j)
    b = j.append(tool="other", inputs={}, outputs={}, manifest={}, parent_run_ids=[a["run_id"]])
    assert {s["run_id"] for s in j.list()} == {a["run_id"], b["run_id"]}
    assert [s["tool"] for s in j.list(tool="other")] == ["other"]
    assert len(j.list(limit=1)) == 1
    assert b["parent_run_ids"] == [a["run_id"]]


def test_artifacts_are_write_once(tmp_path):
    j = Journal(tmp_path)
    first = j.write_artifact("a.csv", "x")
    assert j.write_artifact("a.csv", "x") == first  # idempotent for identical content
    with pytest.raises(JournalError):
        j.write_artifact("a.csv", "different")
    with pytest.raises(ToolInputError):
        j.write_artifact("../escape", "x")


def test_list_reports_a_corrupt_record_per_record_instead_of_failing(tmp_path):
    from nuclei_mcp.journal import Journal
    j = Journal(tmp_path / "j")
    good = j.append(tool="t", inputs={}, outputs={}, manifest={}, parent_run_ids=[])
    bad = j.append(tool="t", inputs={}, outputs={"x": 1}, manifest={}, parent_run_ids=[])
    path = j.root / "runs" / f"{bad['run_id']}.json"
    path.chmod(0o644)
    path.write_text(path.read_text().replace('"x": 1', '"x": 2'))
    by_id = {s["run_id"]: s for s in j.list()}
    assert by_id[good["run_id"]]["integrity"] == "ok"
    assert by_id[bad["run_id"]]["integrity"] == "failed" and "integrity check" in by_id[bad["run_id"]]["error"]
