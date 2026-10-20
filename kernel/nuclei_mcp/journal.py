"""Append-only, write-once research journal.

Layout under the journal directory::

    runs/<run_id>.json          one record per number-producing call
    artifacts/<name>            CSV / circuit files referenced by records

Immutability is enforced three ways: the class exposes no update or delete
operation; files are created with ``O_EXCL`` so an existing record can never be
replaced; and records are made read-only on disk. Each record carries a
``record_sha256`` over its canonical body, verified on every read, so an
out-of-band edit is detected rather than silently trusted.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .errors import JournalError, ToolInputError

SCHEMA_VERSION = 1
RUN_ID_RE = re.compile(r"^run-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$")
_ARTIFACT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def default_journal_dir() -> Path:
    override = os.environ.get("NUCLEI_MCP_JOURNAL")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".nuclei" / "mcp-journal"


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _body_hash(body: Mapping[str, Any]) -> str:
    return sha256_text(canonical_json(body))


def validate_run_id(run_id: str) -> str:
    if not isinstance(run_id, str) or not RUN_ID_RE.match(run_id):
        raise ToolInputError(
            f"run_id {run_id!r} is not a valid journal id (expected 'run-YYYYMMDDTHHMMSSZ-xxxxxxxx')"
        )
    return run_id


def _new_run_id(now: datetime) -> str:
    return f"run-{now.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"


def _write_once(path: Path, text: str) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        fd = os.open(path, flags, 0o444)
    except FileExistsError as exc:
        raise JournalError(f"journal entry {path.name} already exists; records are write-once") from exc
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(path, 0o444)


class Journal:
    """Write-once journal. There is deliberately no update/delete method."""

    def __init__(self, root: Path) -> None:
        self._root = Path(root)
        self._runs = self._root / "runs"
        self._artifacts = self._root / "artifacts"
        self._runs.mkdir(parents=True, exist_ok=True)
        self._artifacts.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    def append(
        self,
        *,
        tool: str,
        inputs: Mapping[str, Any],
        outputs: Mapping[str, Any],
        manifest: Mapping[str, Any],
        parent_run_ids: list[str],
        rerun: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Persist one record and return it (with ``run_id``)."""
        for parent in parent_run_ids:
            self.get(parent)  # a parent must exist and verify
        now = datetime.now(timezone.utc)
        run_id = _new_run_id(now)
        body = {
            "schema_version": SCHEMA_VERSION,
            "run_id": run_id,
            "tool": tool,
            "created_at": now.isoformat(timespec="seconds"),
            "inputs": dict(inputs),
            "outputs": dict(outputs),
            "manifest": dict(manifest),
            "parent_run_ids": list(parent_run_ids),
            "rerun": dict(rerun) if rerun is not None else {"tool": tool, "arguments": dict(inputs)},
        }
        record = {**body, "record_sha256": _body_hash(body)}
        _write_once(self._runs / f"{run_id}.json", json.dumps(record, indent=2, sort_keys=True, allow_nan=False))
        return record

    def get(self, run_id: str) -> dict[str, Any]:
        validate_run_id(run_id)
        path = self._runs / f"{run_id}.json"
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise ToolInputError(f"no journal record for run_id {run_id}") from exc
        except json.JSONDecodeError as exc:
            raise JournalError(f"journal record {run_id} is not valid JSON") from exc
        claimed = record.get("record_sha256")
        body = {k: v for k, v in record.items() if k != "record_sha256"}
        if claimed != _body_hash(body):
            raise JournalError(f"journal record {run_id} failed its integrity check (modified after writing)")
        return record

    def list(self, *, tool: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        """Newest-first summaries (id, tool, time, parents), never full outputs."""
        summaries = []
        for path in sorted(self._runs.glob("run-*.json"), reverse=True):
            try:
                record = self.get(path.stem)
            except JournalError as exc:
                # One bad record must not hide the rest; report it per record.
                summaries.append({"run_id": path.stem, "tool": None, "created_at": "", "parent_run_ids": [],
                                  "integrity": "failed", "error": str(exc)})
                continue
            if tool is not None and record["tool"] != tool:
                continue
            summaries.append(
                {
                    "run_id": record["run_id"],
                    "tool": record["tool"],
                    "created_at": record["created_at"],
                    "parent_run_ids": record["parent_run_ids"],
                    "integrity": "ok",
                }
            )
        return sorted(summaries, key=lambda s: (s["created_at"], s["run_id"]), reverse=True)[:limit]

    def write_artifact(self, name: str, text: str) -> dict[str, str]:
        """Write-once artifact. Re-writing identical content is a no-op."""
        if not _ARTIFACT_RE.match(name):
            raise ToolInputError(f"invalid artifact name {name!r}")
        path = self._artifacts / name
        digest = sha256_text(text)
        if path.exists():
            if sha256_text(path.read_text(encoding="utf-8")) != digest:
                raise JournalError(f"artifact {name} already exists with different content")
        else:
            _write_once(path, text)
        return {"path": str(path), "sha256": digest}
