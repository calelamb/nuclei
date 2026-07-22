from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import pytest


RECORD_COUNT = 10_000_000
BATCH_RECORDS = 65_536
MAX_PEAK_RSS_BYTES = 512 * 1024 * 1024
WORKER_TIMEOUT_SECONDS = 180
MAX_WALL_TIME_SECONDS = 180
PROJECT_ROOT = Path(__file__).parents[3]


def _ru_maxrss_bytes(value: int, platform: str) -> int:
    return value if platform == "darwin" else value * 1024


def _chunks() -> Iterator[object]:
    from kernel.qec_data.adapters.base import ImportChunk, SourceSpan
    from kernel.qec_data.models import IndexRange, PackedBits, SyndromeBatch

    for sequence_start in range(0, RECORD_COUNT, BATCH_RECORDS):
        count = min(BATCH_RECORDS, RECORD_COUNT - sequence_start)
        sequence_end = sequence_start + count
        batch = SyndromeBatch(
            batch_id=f"memory-{sequence_start}",
            session_id="memory-10m",
            segment_id="segment-0001",
            sequence_start=sequence_start,
            sequence_end=sequence_end,
            record_count=count,
            detector_events=PackedBits(8, bytes(count)),
            provenance_id="provenance-memory-10m",
        )
        span = SourceSpan(
            source_id="sha256:" + "a" * 64,
            byte_ranges=(IndexRange(sequence_start, sequence_end),),
            row_range=IndexRange(sequence_start, sequence_end),
        )
        yield ImportChunk(batch, (span,))


def _run_memory_worker(storage_root: Path) -> dict[str, int]:
    import asyncio
    import resource

    from kernel.qec_data.hashing import DatasetSemanticIdentity
    from kernel.qec_data.models import SessionKind, SessionRecord
    from kernel.qec_data.server import _consume_import
    from kernel.qec_data.storage import SessionStorage

    session = SessionRecord.minimal(
        "memory-10m",
        SessionKind.HARDWARE_IMPORT,
        "synthetic-fixed-batch",
        "1",
        "provenance-memory-10m",
    )
    identity = DatasetSemanticIdentity(
        source_sha256=("a" * 64,),
        adapter_id="synthetic-fixed-batch",
        adapter_version="1",
        mapping=(("detectors", "detector_events"),),
        bit_widths=(("detectors", 8),),
        units=(("round", "index"),),
        time_domain="custom",
    )
    storage = SessionStorage.create(storage_root, session, identity)
    summary = asyncio.run(_consume_import(storage, iter(_chunks())))
    partitions = storage.commit_segments(summary.segment_keys)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {
        "records": summary.records_written,
        "partitions": len(partitions),
        "committed_rows": sum(partition.rows for partition in partitions),
        "peak_rss_bytes": _ru_maxrss_bytes(peak, sys.platform),
    }


def _worker_entry(storage_root: str) -> None:
    print(json.dumps(_run_memory_worker(Path(storage_root)), sort_keys=True))


def _run_isolated(storage_root: Path) -> dict[str, int | float]:
    statement = (
        "from kernel.tests.qec_data.test_import_memory_acceptance "
        "import _worker_entry; import sys; _worker_entry(sys.argv[1])"
    )
    environment = {**os.environ, "PYTHONPATH": str(PROJECT_ROOT)}
    started = time.perf_counter()
    completed = subprocess.run(
        [sys.executable, "-c", statement, str(storage_root)],
        cwd=PROJECT_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=WORKER_TIMEOUT_SECONDS,
    )
    wall_time_seconds = time.perf_counter() - started
    assert completed.returncode == 0, completed.stderr
    return {
        **json.loads(completed.stdout.strip()),
        "wall_time_seconds": wall_time_seconds,
    }


def test_ru_maxrss_units_match_supported_posix_platforms() -> None:
    assert _ru_maxrss_bytes(4096, "darwin") == 4096
    assert _ru_maxrss_bytes(4096, "linux") == 4096 * 1024


@pytest.mark.skipif(os.name == "nt", reason="resource.ru_maxrss is POSIX-only")
@pytest.mark.skipif(
    os.environ.get("NUCLEI_RUN_MEMORY_ACCEPTANCE") != "1",
    reason="set NUCLEI_RUN_MEMORY_ACCEPTANCE=1 to run the 10M-record gate",
)
def test_ten_million_record_import_stays_below_memory_budget(tmp_path: Path) -> None:
    result = _run_isolated(tmp_path / "sessions")
    print(json.dumps(result, sort_keys=True))

    assert result["records"] == RECORD_COUNT
    assert result["committed_rows"] == RECORD_COUNT
    assert result["partitions"] == 153
    assert result["peak_rss_bytes"] < MAX_PEAK_RSS_BYTES
    assert result["wall_time_seconds"] < MAX_WALL_TIME_SECONDS
