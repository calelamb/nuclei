"""File-backed job registry so hardware submissions survive kernel restarts.

Without this, killing the kernel mid-poll orphans every queued/running
job: the frontend has IDs the kernel no longer recognises, status polls
return errors, and the user assumes their submission vanished (the job
is usually still running on the provider).

Scope for this PRD:
- Persist the job's metadata (id, provider, backend, status, shots,
  timestamps, last seen status, error).
- On kernel start, re-hydrate the manager's registry so `JobTracker`
  shows historical jobs.
- Jobs that were non-terminal at shutdown come back as `stale` — the
  kernel no longer has the SDK handle, so live polling can't resume.
  The user can re-submit to run them again. True per-provider
  re-attachment (calling e.g. `QiskitRuntimeService.job(id)` to rebind
  the SDK handle) is explicitly deferred — that's a future PRD.
- LRU cap at 200 entries; terminal jobs older than 7 days are pruned
  on save so the file can't grow unbounded.

Storage: JSON file at `<NUCLEI_DATA_DIR or ~/.nuclei>/jobs.json`.
Writes are atomic via a temp-file-and-rename pattern so a crash during
save can't corrupt the registry.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from dataclasses import asdict, dataclass, field

_LOG = logging.getLogger(__name__)

# Hard caps. The prune runs inline on each save so writes stay bounded.
MAX_ENTRIES = 200
TERMINAL_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days

TERMINAL_STATUSES = frozenset({"complete", "failed", "cancelled"})


def _default_data_dir() -> str:
    override = os.environ.get("NUCLEI_DATA_DIR")
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".nuclei")


def _default_path() -> str:
    return os.path.join(_default_data_dir(), "jobs.json")


@dataclass
class JobRecord:
    """Serialised job metadata — minimal fields needed to rebuild a
    JobHandle for the frontend on restart. Keep this lean: it ends up
    on disk, and adding fields means thinking about schema migration."""

    job_id: str
    provider: str
    backend: str
    status: str
    shots: int
    submitted_at: str
    # ISO timestamp of the most recent status update. Used for TTL pruning
    # of terminal jobs so a user who ran 100 jobs in a week doesn't see the
    # tracker fill up forever.
    last_updated_at: str
    queue_position: int | None = None
    error: str | None = None
    # Optional snapshot of the circuit that produced this job. Not yet
    # written by the submit flow — reserved for future "re-run this job"
    # functionality.
    circuit_qasm: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "JobRecord":
        # Be forgiving about missing keys so we can add fields in the
        # future without a hard migration — unknown-to-older-schema fields
        # just get their defaults.
        return cls(
            job_id=data["job_id"],
            provider=data["provider"],
            backend=data["backend"],
            status=data["status"],
            shots=int(data.get("shots", 0)),
            submitted_at=data["submitted_at"],
            last_updated_at=data.get("last_updated_at", data["submitted_at"]),
            queue_position=data.get("queue_position"),
            error=data.get("error"),
            circuit_qasm=data.get("circuit_qasm"),
        )


@dataclass
class JobStore:
    path: str = field(default_factory=_default_path)
    _records: dict[str, JobRecord] = field(default_factory=dict)

    def load(self) -> None:
        """Read the backing file, silently starting fresh on any problem."""
        self._records = {}
        if not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            _LOG.warning("Job store at %s unreadable (%s); starting fresh.", self.path, exc)
            return
        raw_entries = data.get("jobs", []) if isinstance(data, dict) else []
        if not isinstance(raw_entries, list):
            return
        for entry in raw_entries:
            if not isinstance(entry, dict):
                continue
            try:
                record = JobRecord.from_dict(entry)
            except (KeyError, TypeError, ValueError):
                continue
            self._records[record.job_id] = record

    def save(self) -> None:
        """Atomically write the registry to disk after pruning."""
        self._prune()
        directory = os.path.dirname(self.path) or "."
        try:
            os.makedirs(directory, exist_ok=True)
        except OSError as exc:
            _LOG.warning("Could not create job store dir %s: %s", directory, exc)
            return
        payload = {"jobs": [r.to_dict() for r in self._records.values()]}
        # Write to a temp file in the same directory, then rename for
        # atomicity — the old file either stays intact or is replaced by a
        # fully-written new one, never a partial write.
        fd, tmp_path = tempfile.mkstemp(prefix=".jobs.", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
            os.replace(tmp_path, self.path)
        except OSError as exc:
            _LOG.warning("Job store write failed: %s", exc)
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def _prune(self) -> None:
        """Drop terminal entries older than TTL; enforce the LRU cap."""
        now = time.time()
        survivors: list[JobRecord] = []
        for r in self._records.values():
            if r.status in TERMINAL_STATUSES:
                age = now - _parse_iso_seconds(r.last_updated_at)
                if age > TERMINAL_TTL_SECONDS:
                    continue
            survivors.append(r)
        survivors.sort(key=lambda r: _parse_iso_seconds(r.last_updated_at))
        if len(survivors) > MAX_ENTRIES:
            survivors = survivors[-MAX_ENTRIES:]
        self._records = {r.job_id: r for r in survivors}

    # ── public API ──

    def upsert(self, record: JobRecord) -> None:
        self._records[record.job_id] = record
        self.save()

    def update_status(
        self,
        job_id: str,
        *,
        status: str | None = None,
        queue_position: int | None = None,
        error: str | None = None,
    ) -> None:
        record = self._records.get(job_id)
        if record is None:
            return
        if status is not None:
            record.status = status
        if queue_position is not None:
            record.queue_position = queue_position
        if error is not None:
            record.error = error
        from datetime import datetime, timezone
        record.last_updated_at = datetime.now(timezone.utc).isoformat()
        self.save()

    def remove(self, job_id: str) -> None:
        if self._records.pop(job_id, None) is not None:
            self.save()

    def get(self, job_id: str) -> JobRecord | None:
        return self._records.get(job_id)

    def all(self) -> list[JobRecord]:
        return list(self._records.values())


def _parse_iso_seconds(iso: str) -> float:
    try:
        from datetime import datetime
        return datetime.fromisoformat(iso).timestamp()
    except (ValueError, TypeError):
        return 0.0
