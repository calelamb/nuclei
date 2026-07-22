from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

import pytest


RECORD_COUNT = 10_000_000
MAX_PEAK_RSS_BYTES = 512 * 1024 * 1024
WORKER_TIMEOUT_SECONDS = 300
MAX_WALL_TIME_SECONDS = 285
SOURCE_WRITE_RECORDS = 1_048_576
STIM_B8_RECORD = b"\x05"
PROJECT_ROOT = Path(__file__).parents[3]


def _ru_maxrss_bytes(value: int, platform: str) -> int:
    return value if platform == "darwin" else value * 1024


def _windows_peak_working_set_bytes() -> int:
    import ctypes
    from ctypes import wintypes

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = (
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        )

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    get_current_process = kernel32.GetCurrentProcess
    get_current_process.restype = wintypes.HANDLE
    get_process_memory_info = psapi.GetProcessMemoryInfo
    get_process_memory_info.argtypes = (
        wintypes.HANDLE,
        ctypes.POINTER(ProcessMemoryCounters),
        wintypes.DWORD,
    )
    get_process_memory_info.restype = wintypes.BOOL
    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    if not get_process_memory_info(
        get_current_process(), ctypes.byref(counters), counters.cb
    ):
        error_code = ctypes.get_last_error()
        raise OSError(error_code, "GetProcessMemoryInfo failed")
    return int(counters.PeakWorkingSetSize)


def _peak_rss_bytes(
    platform: str,
    *,
    windows_reader: Callable[[], int] = _windows_peak_working_set_bytes,
) -> int:
    if platform == "win32":
        return windows_reader()
    import resource

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return _ru_maxrss_bytes(peak, platform)


def _write_stim_b8_source(source: Path, *, record_count: int) -> None:
    if type(record_count) is not int or record_count < 1:
        raise ValueError("record_count must be a positive integer")
    remaining = record_count
    with source.open("wb") as stream:
        while remaining:
            count = min(remaining, SOURCE_WRITE_RECORDS)
            stream.write(STIM_B8_RECORD * count)
            remaining -= count


def _run_memory_worker(storage_root: Path) -> dict[str, int | str]:
    import asyncio

    from kernel.qec_data.adapters.base import ImportMapping
    from kernel.qec_data.adapters.registry import core_offline_registry
    from kernel.qec_data.hashing import DatasetSemanticIdentity
    from kernel.qec_data.models import SessionKind, SessionRecord
    from kernel.qec_data.server import _consume_import
    from kernel.qec_data.storage import SessionStorage

    source = storage_root.parent / "stim-memory-10m.b8"
    _write_stim_b8_source(source, record_count=RECORD_COUNT)
    adapter = core_offline_registry().get("stim-results", "1")
    mapping = ImportMapping(
        options=(
            ("detector_count", 8),
            ("observable_count", 0),
            ("segment_id", "segment-0001"),
            ("session_id", "memory-10m"),
        ),
        expected_provenance_id="provenance-memory-10m",
    )
    probe = adapter.probe(source)
    if not probe.supported or probe.source_kind != "stim-b8":
        raise RuntimeError("registered Stim adapter did not recognize the b8 source")
    if probe.source_sha256 is None:
        raise RuntimeError("registered Stim adapter omitted the source identity")
    session = SessionRecord.minimal(
        "memory-10m",
        SessionKind.HARDWARE_IMPORT,
        adapter.manifest.id,
        adapter.manifest.version,
        "provenance-memory-10m",
    )
    identity = DatasetSemanticIdentity(
        source_sha256=(probe.source_sha256,),
        adapter_id=adapter.manifest.id,
        adapter_version=adapter.manifest.version,
        mapping=(("detectors", "detector_events"),),
        bit_widths=(("detectors", 8),),
        units=(("round", "index"),),
        time_domain="custom",
    )
    storage = SessionStorage.create(storage_root, session, identity)
    summary = asyncio.run(
        _consume_import(storage, adapter.import_batches(source, mapping))
    )
    partitions = storage.commit_segments(summary.segment_keys)
    return {
        "adapter_id": adapter.manifest.id,
        "adapter_version": adapter.manifest.version,
        "measurement_backend": (
            "PeakWorkingSetSize" if sys.platform == "win32" else "ru_maxrss"
        ),
        "source_bytes": source.stat().st_size,
        "source_kind": probe.source_kind,
        "records": summary.records_written,
        "partitions": len(partitions),
        "committed_rows": sum(partition.rows for partition in partitions),
        "peak_rss_bytes": _peak_rss_bytes(sys.platform),
    }


def _worker_entry(storage_root: str) -> None:
    print(json.dumps(_run_memory_worker(Path(storage_root)), sort_keys=True))


def _run_isolated(storage_root: Path) -> dict[str, int | float | str]:
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


def test_real_stim_source_writer_emits_one_b8_record_per_shot(
    tmp_path: Path,
) -> None:
    source = tmp_path / "shots.b8"

    _write_stim_b8_source(source, record_count=10)

    assert source.read_bytes() == b"\x05" * 10


def test_peak_rss_dispatches_to_windows_peak_working_set() -> None:
    assert _peak_rss_bytes("win32", windows_reader=lambda: 1234) == 1234


@pytest.mark.skipif(
    os.environ.get("NUCLEI_RUN_MEMORY_ACCEPTANCE") != "1",
    reason="set NUCLEI_RUN_MEMORY_ACCEPTANCE=1 to run the 10M-record gate",
)
def test_ten_million_record_import_stays_below_memory_budget(tmp_path: Path) -> None:
    result = _run_isolated(tmp_path / "sessions")
    print(json.dumps(result, sort_keys=True))

    assert result["adapter_id"] == "stim-results"
    assert result["adapter_version"] == "1"
    assert result["source_kind"] == "stim-b8"
    assert result["source_bytes"] == RECORD_COUNT
    assert result["measurement_backend"] == (
        "PeakWorkingSetSize" if sys.platform == "win32" else "ru_maxrss"
    )
    assert result["records"] == RECORD_COUNT
    assert result["committed_rows"] == RECORD_COUNT
    assert result["partitions"] == 153
    assert result["peak_rss_bytes"] < MAX_PEAK_RSS_BYTES
    assert result["wall_time_seconds"] < MAX_WALL_TIME_SECONDS
