"""Reusable compliance runner for core and third-party QEC data adapters."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import os
import queue
import threading
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from itertools import islice
from pathlib import Path
from typing import Protocol

from kernel.qec_data.adapters.base import (
    AdapterCancelled,
    AdapterCapability,
    AdapterCommand,
    AdapterManifest,
    CanonicalBatch,
    CommandSuccessResult,
    ImportMapping,
    PreviewResult,
    ProbeResult,
    StreamConfig,
    UnsupportedCapabilityResult,
    ValidationReport,
    compute_source_sha256,
)
from kernel.qec_data.models import SyndromeBatch


PREVIEW_LIMIT = 3
IMPORT_BATCH_LIMIT = 64
ASYNC_TIMEOUT_SECONDS = 0.25
SYNC_TIMEOUT_SECONDS = 0.25


class AdapterLike(Protocol):
    manifest: AdapterManifest


@dataclass(frozen=True, slots=True)
class ContractFailure:
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class AdapterContractReport:
    failures: tuple[ContractFailure, ...]

    @property
    def failure_codes(self) -> tuple[str, ...]:
        return tuple(failure.code for failure in self.failures)

    @property
    def passed(self) -> bool:
        return not self.failures


@dataclass(slots=True)
class _ObservedCancelled:
    observed: bool = False

    @property
    def is_cancelled(self) -> bool:
        self.observed = True
        return True

    def raise_if_cancelled(self) -> None:
        self.observed = True
        raise AdapterCancelled("contract cancellation")


@dataclass(frozen=True, slots=True)
class _SourceEntry:
    relative_path: str
    kind: str
    mode: int
    size: int
    modified_ns: int
    changed_ns: int
    device: int
    inode: int
    owner: int
    group: int
    content_sha256: str


@dataclass(frozen=True, slots=True)
class _CallOutcome:
    value: object | None = None
    error: Exception | None = None
    timed_out: bool = False


class _FailureCollector:
    def __init__(self) -> None:
        self._failures: list[ContractFailure] = []

    def add(self, code: str, message: str) -> None:
        if code not in {failure.code for failure in self._failures}:
            self._failures.append(ContractFailure(code, message))

    def report(self) -> AdapterContractReport:
        return AdapterContractReport(tuple(self._failures))


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _entry(root: Path, path: Path) -> _SourceEntry:
    stat = path.lstat()
    relative = "." if path == root else path.relative_to(root).as_posix()
    if path.is_symlink():
        kind, digest = "symlink", hashlib.sha256(os.readlink(path).encode()).hexdigest()
    elif path.is_file():
        kind, digest = "file", _file_digest(path)
    else:
        kind, digest = "directory", ""
    return _SourceEntry(
        relative_path=relative,
        kind=kind,
        mode=stat.st_mode,
        size=stat.st_size,
        modified_ns=stat.st_mtime_ns,
        changed_ns=stat.st_ctime_ns,
        device=stat.st_dev,
        inode=stat.st_ino,
        owner=getattr(stat, "st_uid", 0),
        group=getattr(stat, "st_gid", 0),
        content_sha256=digest,
    )


def _snapshot(source: Path) -> tuple[_SourceEntry, ...]:
    if not source.exists() and not source.is_symlink():
        return ()
    if not source.is_dir() or source.is_symlink():
        return (_entry(source, source),)
    paths = (source, *sorted(source.rglob("*"), key=lambda path: path.as_posix()))
    return tuple(_entry(source, path) for path in paths)


def _bounded_call(call: Callable[[], object]) -> _CallOutcome:
    outcomes: queue.Queue[_CallOutcome] = queue.Queue(maxsize=1)

    def invoke() -> None:
        try:
            outcomes.put(_CallOutcome(value=call()))
        except Exception as error:  # broken plugins are reported, not propagated
            outcomes.put(_CallOutcome(error=error))

    threading.Thread(target=invoke, daemon=True).start()
    try:
        return outcomes.get(timeout=SYNC_TIMEOUT_SECONDS)
    except queue.Empty:
        return _CallOutcome(timed_out=True)


def _call_read_only(
    operation: str,
    source: Path,
    call: Callable[[], object],
    failures: _FailureCollector,
) -> object | None:
    before = _snapshot(source)
    outcome = _bounded_call(call)
    if outcome.timed_out:
        code = (
            "preview_unbounded" if operation == "preview" else f"{operation}_timed_out"
        )
        failures.add(code, f"{operation} did not finish within the compliance bound")
    elif outcome.error is not None:
        error = outcome.error
        failures.add(f"{operation}_raised", f"{type(error).__name__}: {error}")
    after = _snapshot(source)
    if after != before:
        failures.add(
            f"{operation}_changed_source",
            f"{operation} changed source data or metadata",
        )
    return outcome.value


def _is_unsupported(value: object, capability: AdapterCapability) -> bool:
    return (
        isinstance(value, UnsupportedCapabilityResult)
        and value.capability is capability
    )


def _check_capability_result(
    manifest: AdapterManifest,
    capability: AdapterCapability,
    value: object,
    failures: _FailureCollector,
) -> None:
    declared = capability in manifest.capabilities
    unsupported_result = _is_unsupported(value, capability)
    if declared and unsupported_result:
        failures.add(
            "declared_capability_unsupported",
            f"{capability.value} is declared but unsupported",
        )
    if not declared and not unsupported_result:
        failures.add(
            "undeclared_capability_available",
            f"{capability.value} is available but undeclared",
        )


def _check_probe(
    manifest: AdapterManifest,
    result: object,
    source_sha256: str,
    failures: _FailureCollector,
) -> None:
    _check_capability_result(manifest, AdapterCapability.PROBE, result, failures)
    if AdapterCapability.PROBE not in manifest.capabilities or _is_unsupported(
        result, AdapterCapability.PROBE
    ):
        return
    if not isinstance(result, ProbeResult):
        failures.add("probe_result_invalid", "probe did not return ProbeResult")
        return
    if result.source_sha256 != source_sha256:
        failures.add(
            "probe_source_hash_mismatch", "probe omitted or changed the source hash"
        )
    if result.supported and result.source_kind not in manifest.source_kinds:
        failures.add(
            "probe_source_kind_undeclared", "probe returned an undeclared source kind"
        )


def _check_validation(
    manifest: AdapterManifest,
    result: object,
    source_sha256: str,
    failures: _FailureCollector,
) -> str | None:
    _check_capability_result(manifest, AdapterCapability.VALIDATE, result, failures)
    if AdapterCapability.VALIDATE not in manifest.capabilities or _is_unsupported(
        result, AdapterCapability.VALIDATE
    ):
        return None
    if not isinstance(result, ValidationReport):
        failures.add(
            "validation_result_invalid", "validate did not return ValidationReport"
        )
        return None
    if result.source_sha256 != source_sha256:
        failures.add(
            "validation_source_hash_mismatch",
            "validation source hash is absent or mismatched",
        )
    if not result.provenance_id:
        failures.add(
            "validation_provenance_absent", "validation omitted provenance identity"
        )
    return result.provenance_id


def _preview_record_count(result: PreviewResult) -> int:
    return sum(batch.record_count for batch in result.batches)


def _check_preview(
    manifest: AdapterManifest,
    first: object,
    second: object,
    source_sha256: str,
    provenance_id: str | None,
    failures: _FailureCollector,
) -> None:
    _check_capability_result(manifest, AdapterCapability.PREVIEW, first, failures)
    if AdapterCapability.PREVIEW not in manifest.capabilities or _is_unsupported(
        first, AdapterCapability.PREVIEW
    ):
        return
    if not isinstance(first, PreviewResult) or not isinstance(second, PreviewResult):
        failures.add("preview_result_invalid", "preview did not return PreviewResult")
        return
    if first != second:
        failures.add(
            "preview_nondeterministic",
            "identical preview calls returned different values",
        )
    if not all(isinstance(batch, SyndromeBatch) for batch in first.batches):
        failures.add("preview_batch_invalid", "preview contains a non-canonical batch")
        return
    if (
        _preview_record_count(first) > PREVIEW_LIMIT
        or len(first.batches) > PREVIEW_LIMIT
    ):
        failures.add(
            "preview_limit_exceeded", "preview returned more records than requested"
        )
    if first.source_sha256 != source_sha256:
        failures.add(
            "preview_source_hash_mismatch",
            "preview source hash is absent or mismatched",
        )
    if not first.provenance_id:
        failures.add("preview_provenance_absent", "preview omitted provenance identity")
    elif provenance_id and first.provenance_id != provenance_id:
        failures.add(
            "preview_provenance_mismatch", "preview and validation provenance differ"
        )


def _bounded_batches(
    value: object, failures: _FailureCollector
) -> tuple[CanonicalBatch, ...]:
    if not isinstance(value, Iterator):
        failures.add(
            "import_result_invalid", "import_batches did not return an iterator"
        )
        return ()
    outcome = _bounded_call(lambda: _sample_and_close(value))
    if outcome.timed_out:
        failures.add(
            "import_sample_unbounded", "import sample did not finish within the bound"
        )
        return ()
    if outcome.error is not None:
        error = outcome.error
        failures.add("import_iteration_raised", f"{type(error).__name__}: {error}")
        return ()
    batches = outcome.value
    if not isinstance(batches, tuple):
        failures.add("import_result_invalid", "import sample did not produce a tuple")
        return ()
    if len(batches) > IMPORT_BATCH_LIMIT:
        failures.add(
            "import_sample_unbounded", "import sample exceeded the compliance bound"
        )
    return batches[:IMPORT_BATCH_LIMIT]


def _consume_import_read_only(
    source: Path, value: object, failures: _FailureCollector
) -> tuple[CanonicalBatch, ...]:
    before = _snapshot(source)
    batches = _bounded_batches(value, failures)
    after = _snapshot(source)
    if after != before:
        failures.add(
            "import_changed_source",
            "import iteration changed source data or metadata",
        )
    return batches


def _sample_and_close(value: Iterator[object]) -> tuple[object, ...]:
    try:
        return tuple(islice(value, IMPORT_BATCH_LIMIT + 1))
    finally:
        close = getattr(value, "close", None)
        if callable(close):
            close()


def _check_one_batch(
    batch: object, failures: _FailureCollector
) -> SyndromeBatch | None:
    if not isinstance(batch, SyndromeBatch):
        failures.add("batch_type_invalid", "import yielded a non-canonical batch")
        return None
    try:
        expected = batch.detector_events.bytes_per_record * batch.record_count
        valid_buffer = len(batch.detector_events.data) == expected
        valid_sequence = batch.sequence_end - batch.sequence_start == batch.record_count
    except (AttributeError, TypeError, ValueError) as error:
        failures.add("batch_record_invariant_invalid", f"malformed batch: {error}")
        return None
    if not valid_buffer or not valid_sequence:
        failures.add(
            "batch_record_invariant_invalid", "batch width/count invariants failed"
        )
    return batch


def _check_batch_order(
    batches: tuple[SyndromeBatch, ...], failures: _FailureCollector
) -> None:
    previous: dict[tuple[str, str], SyndromeBatch] = {}
    for batch in batches:
        key = batch.session_id, batch.segment_id
        prior = previous.get(key)
        if prior and batch.sequence_start < prior.sequence_start:
            failures.add(
                "batch_sequence_nonmonotonic", "batch sequence starts moved backwards"
            )
        if prior and batch.sequence_start < prior.sequence_end:
            failures.add("batch_sequence_overlap", "batch sequence ranges overlap")
        previous[key] = batch


def _check_batches(
    values: tuple[CanonicalBatch, ...],
    provenance_id: str | None,
    failures: _FailureCollector,
) -> None:
    valid = tuple(
        batch for value in values if (batch := _check_one_batch(value, failures))
    )
    _check_batch_order(valid, failures)
    widths_by_segment: dict[tuple[str, str], set[int]] = {}
    for batch in valid:
        key = batch.session_id, batch.segment_id
        widths_by_segment.setdefault(key, set()).add(batch.detector_events.bit_width)
    if any(len(widths) > 1 for widths in widths_by_segment.values()):
        failures.add(
            "batch_width_changed", "detector width changed within an import segment"
        )
    for batch in valid:
        if not batch.provenance_id:
            failures.add("batch_provenance_absent", "batch omitted provenance identity")
        elif provenance_id and batch.provenance_id != provenance_id:
            failures.add(
                "batch_provenance_mismatch", "batch and validation provenance differ"
            )


async def _resolve_stream(value: object) -> object:
    return await value if inspect.isawaitable(value) else value


async def _consume_stream(
    value: object, failures: _FailureCollector
) -> tuple[CanonicalBatch, ...]:
    resolved: object | None = None
    batches: list[CanonicalBatch] = []
    try:
        async with asyncio.timeout(ASYNC_TIMEOUT_SECONDS):
            resolved = await _resolve_stream(value)
            if isinstance(resolved, UnsupportedCapabilityResult):
                return (resolved,)  # type: ignore[return-value]
            if not isinstance(resolved, AsyncIterator):
                failures.add(
                    "stream_result_invalid",
                    "stream_batches did not return an async iterator",
                )
                return ()
            async for batch in resolved:
                batches.append(batch)
                if len(batches) > IMPORT_BATCH_LIMIT:
                    break
    except AdapterCancelled:
        pass
    except TimeoutError:
        failures.add(
            "stream_did_not_cancel", "cancelled stream did not finish promptly"
        )
    finally:
        close = getattr(resolved, "aclose", None)
        if callable(close):
            try:
                await asyncio.wait_for(close(), timeout=ASYNC_TIMEOUT_SECONDS)
            except TimeoutError:
                failures.add("stream_close_timed_out", "stream did not close promptly")
    return tuple(batches)


def _check_stream(
    adapter: object, manifest: AdapterManifest, failures: _FailureCollector
) -> None:
    cancel = _ObservedCancelled()
    stream_method = getattr(adapter, "stream_batches", None)
    if AdapterCapability.STREAM in manifest.capabilities and callable(stream_method):
        if len(inspect.signature(stream_method).parameters) != 1:
            failures.add(
                "stream_missing_cancellation",
                "stream cannot receive cancellation through StreamConfig",
            )
    try:
        call = stream_method(StreamConfig(manifest.source_kinds[0], cancel=cancel))
        batches = asyncio.run(_consume_stream(call, failures))
    except Exception as error:
        if not isinstance(error, AdapterCancelled):
            failures.add("stream_raised", f"{type(error).__name__}: {error}")
        batches = ()
    unsupported_result = (
        batches[0]
        if batches and isinstance(batches[0], UnsupportedCapabilityResult)
        else None
    )
    _check_capability_result(
        manifest, AdapterCapability.STREAM, unsupported_result, failures
    )
    if AdapterCapability.STREAM in manifest.capabilities and not cancel.observed:
        failures.add(
            "stream_missing_cancellation",
            "stream did not observe its cancellation token",
        )
    if AdapterCapability.STREAM in manifest.capabilities and batches:
        failures.add("stream_ignored_cancellation", "stream yielded after cancellation")


def _check_command(
    adapter: object, manifest: AdapterManifest, failures: _FailureCollector
) -> None:
    try:
        command = adapter.command(AdapterCommand("contract.health"))
        result = asyncio.run(_await_command(command))
    except TimeoutError:
        failures.add("command_timed_out", "command did not finish promptly")
        return
    except Exception as error:
        failures.add("command_raised", f"{type(error).__name__}: {error}")
        return
    _check_capability_result(manifest, AdapterCapability.COMMAND, result, failures)
    if AdapterCapability.COMMAND in manifest.capabilities and not isinstance(
        result, (CommandSuccessResult, UnsupportedCapabilityResult)
    ):
        failures.add("command_result_invalid", "command did not return CommandResult")


async def _await_command(value: object) -> object:
    if not inspect.isawaitable(value):
        return value
    async with asyncio.timeout(ASYNC_TIMEOUT_SECONDS):
        return await value


def _manifest(adapter: object, failures: _FailureCollector) -> AdapterManifest | None:
    manifest = getattr(adapter, "manifest", None)
    if not isinstance(manifest, AdapterManifest):
        failures.add("manifest_invalid", "adapter manifest is absent or invalid")
        return None
    missing = tuple(
        capability.value
        for capability in AdapterCapability
        if not callable(getattr(adapter, capability.value, None))
    )
    if missing:
        failures.add(
            "adapter_method_missing",
            f"required methods are missing: {', '.join(missing)}",
        )
    return manifest


def _instantiate(
    adapter_factory: Callable[[], AdapterLike], failures: _FailureCollector
) -> object | None:
    try:
        return adapter_factory()
    except Exception as error:
        failures.add("adapter_factory_raised", f"{type(error).__name__}: {error}")
        return None


def run_adapter_contract(
    adapter_factory: Callable[[], AdapterLike], source: Path
) -> AdapterContractReport:
    """Run bounded, crash-isolated checks against one adapter instance."""

    failures = _FailureCollector()
    adapter = _instantiate(adapter_factory, failures)
    if adapter is None:
        return failures.report()
    manifest = _manifest(adapter, failures)
    if manifest is None or not manifest.source_kinds:
        return failures.report()
    mapping = ImportMapping(expected_provenance_id="contract-provenance")
    try:
        source_sha256 = compute_source_sha256(source)
    except (OSError, ValueError) as error:
        failures.add("source_invalid", f"{type(error).__name__}: {error}")
        return failures.report()
    probe = _call_read_only("probe", source, lambda: adapter.probe(source), failures)
    _check_probe(manifest, probe, source_sha256, failures)
    validation = _call_read_only(
        "validate", source, lambda: adapter.validate(source, mapping), failures
    )
    provenance_id = _check_validation(manifest, validation, source_sha256, failures)
    first = _call_read_only(
        "preview",
        source,
        lambda: adapter.preview(source, mapping, PREVIEW_LIMIT),
        failures,
    )
    second = _call_read_only(
        "preview",
        source,
        lambda: adapter.preview(source, mapping, PREVIEW_LIMIT),
        failures,
    )
    _check_preview(manifest, first, second, source_sha256, provenance_id, failures)
    imported = _call_read_only(
        "import", source, lambda: adapter.import_batches(source, mapping), failures
    )
    _check_capability_result(manifest, AdapterCapability.IMPORT, imported, failures)
    if AdapterCapability.IMPORT in manifest.capabilities and not _is_unsupported(
        imported, AdapterCapability.IMPORT
    ):
        batches = _consume_import_read_only(source, imported, failures)
        _check_batches(batches, provenance_id, failures)
    _check_stream(adapter, manifest, failures)
    _check_command(adapter, manifest, failures)
    return failures.report()
