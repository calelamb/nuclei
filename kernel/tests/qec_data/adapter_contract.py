"""Process-isolated compliance runner for QEC data adapters."""

from __future__ import annotations

import asyncio
import inspect
import multiprocessing
import os
import time
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from kernel.qec_data.adapters.base import (
    AdapterCancelled,
    AdapterCapability,
    AdapterCommand,
    AdapterManifest,
    CommandSuccessResult,
    ImportMapping,
    PreviewResult,
    ProbeResult,
    SourceFingerprintEntry,
    StreamConfig,
    UnsupportedCapabilityResult,
    ValidationReport,
    compute_source_sha256,
    fingerprint_source,
)
from kernel.qec_data.model_codecs import batch_from_mapping, batch_to_mapping
from kernel.qec_data.model_validation import DataQualityFlag
from kernel.qec_data.models import SyndromeBatch
from kernel.tests.qec_data.adapter_process_isolation import (
    IsolationBackend,
    bounded_source_snapshot,
    detect_secure_isolation_backend as detect_secure_isolation_backend,
    factory_is_spawn_importable as factory_is_spawn_importable,
    receive_worker_report,
    resolve_isolation_backend,
    trusted_process_group_backend as trusted_process_group_backend,
)


PREVIEW_LIMIT = 3
IMPORT_BATCH_LIMIT = 64
CONTRACT_TIMEOUT_SECONDS = 4.0
SNAPSHOT_TIMEOUT_SECONDS = 1.0


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


class _FailureCollector:
    def __init__(self) -> None:
        self._failures: list[ContractFailure] = []

    def add(self, code: str, message: str) -> None:
        if code not in {failure.code for failure in self._failures}:
            self._failures.append(ContractFailure(code, message))

    def report(self) -> AdapterContractReport:
        return AdapterContractReport(tuple(self._failures))


class _StageReporter:
    def __init__(self, send: Callable[[tuple[str, object]], None]) -> None:
        self._send = send
        self.current = "startup"

    def set(self, stage: str) -> None:
        self.current = stage
        self._send(("stage", stage))


def _snapshot_or_failure(
    source: Path, failures: _FailureCollector, code: str
) -> tuple[SourceFingerprintEntry, ...] | None:
    try:
        return fingerprint_source(source)
    except BaseException as error:
        failures.add(code, f"{type(error).__name__}: {error}")
        return None


def _call_read_only(
    operation: str,
    source: Path,
    call: Callable[[], object],
    failures: _FailureCollector,
    stages: _StageReporter,
) -> object | None:
    before = _snapshot_or_failure(source, failures, f"{operation}_snapshot_raised")
    stages.set(operation)
    try:
        result = call()
    except BaseException as error:
        failures.add(f"{operation}_raised", f"{type(error).__name__}: {error}")
        result = None
    after = _snapshot_or_failure(source, failures, f"{operation}_snapshot_raised")
    if before is not None and after is not None and before != after:
        failures.add(f"{operation}_changed_source", f"{operation} changed the source")
    return result


def _manifest(adapter: object, failures: _FailureCollector) -> AdapterManifest | None:
    try:
        manifest = getattr(adapter, "manifest")
    except BaseException as error:
        failures.add("manifest_raised", f"{type(error).__name__}: {error}")
        return None
    if type(manifest) is not AdapterManifest:
        failures.add("manifest_invalid", "adapter manifest is absent or invalid")
        return None
    try:
        return AdapterManifest(
            manifest.id,
            manifest.version,
            manifest.capabilities,
            manifest.source_kinds,
        )
    except BaseException as error:
        failures.add("manifest_invalid", f"{type(error).__name__}: {error}")
        return None


def _check_required_methods(adapter: object, failures: _FailureCollector) -> None:
    missing: list[str] = []
    for capability in AdapterCapability:
        try:
            available = callable(getattr(adapter, capability.value))
        except BaseException:
            available = False
        if not available:
            missing.append(capability.value)
    if missing:
        failures.add(
            "adapter_method_missing", f"required methods missing: {', '.join(missing)}"
        )


def _check_probe(
    result: object,
    manifest: AdapterManifest,
    source_hash: str,
    failures: _FailureCollector,
) -> None:
    if isinstance(result, UnsupportedCapabilityResult):
        failures.add(
            "probe_unsupported_invalid", "probe is a mandatory core capability"
        )
        return
    if type(result) is not ProbeResult:
        failures.add("probe_result_invalid", "probe did not return ProbeResult")
        return
    if result.source_sha256 != source_hash:
        failures.add(
            "probe_source_hash_mismatch", "probe source hash is absent or mismatched"
        )
    if result.supported and result.source_kind not in manifest.source_kinds:
        failures.add(
            "probe_source_kind_undeclared", "probe returned an undeclared source kind"
        )


def _check_validation(
    result: object,
    source_hash: str,
    expected_provenance_id: str | None,
    failures: _FailureCollector,
) -> str | None:
    if isinstance(result, UnsupportedCapabilityResult):
        failures.add(
            "validate_unsupported_invalid", "validate is a mandatory core capability"
        )
        return None
    if type(result) is not ValidationReport:
        failures.add(
            "validation_result_invalid", "validate did not return ValidationReport"
        )
        return None
    if result.source_sha256 != source_hash:
        failures.add(
            "validation_source_hash_mismatch", "validation source hash mismatched"
        )
    if not result.provenance_id:
        failures.add(
            "validation_provenance_absent", "validation omitted provenance identity"
        )
    if expected_provenance_id and result.provenance_id != expected_provenance_id:
        failures.add(
            "validation_mapping_provenance_mismatch",
            "validation provenance mismatched the import mapping",
        )
    return result.provenance_id


def _canonical_batch(
    value: object, failures: _FailureCollector
) -> SyndromeBatch | None:
    if type(value) is not SyndromeBatch:
        failures.add("batch_type_invalid", "adapter yielded a non-canonical batch")
        return None
    try:
        return batch_from_mapping(batch_to_mapping(value))
    except BaseException as error:
        failures.add("batch_canonical_invalid", f"{type(error).__name__}: {error}")
        return None


def _check_batch_sequence(
    batch: SyndromeBatch,
    previous: SyndromeBatch | None,
    failures: _FailureCollector,
) -> None:
    if previous is None:
        return
    if batch.sequence_start < previous.sequence_start:
        failures.add("batch_sequence_nonmonotonic", "batch sequence moved backwards")
    if batch.sequence_start < previous.sequence_end:
        failures.add("batch_sequence_overlap", "batch sequence ranges overlap")
    has_gap = batch.sequence_start > previous.sequence_end
    marks_gap = DataQualityFlag.GAP_BEFORE in batch.data_quality
    if has_gap and not marks_gap:
        failures.add("batch_sequence_gap", "batch sequence ranges contain a gap")
    if not has_gap and marks_gap:
        failures.add(
            "batch_sequence_false_gap", "GAP_BEFORE requires a sequence discontinuity"
        )


def _packed_schema_profile(batch: SyndromeBatch) -> tuple[tuple[bool, int | None], ...]:
    names = ("measurements", "observables", "erasures", "leakage", "heralds")
    return tuple(
        (packed.value is not None, packed.value.bit_width if packed.value else None)
        for packed in (getattr(batch, name) for name in names)
    )


def _batch_schema_profile(batch: SyndromeBatch) -> tuple[object, ...]:
    timestamps = batch.source_timestamps.value
    return (
        batch.detector_events.bit_width,
        _packed_schema_profile(batch),
        (timestamps is not None, timestamps.unit if timestamps else None),
        batch.round_range.value is not None,
    )


def _check_batches(
    values: tuple[object, ...],
    provenance_id: str | None,
    expected_provenance_id: str | None,
    failures: _FailureCollector,
) -> None:
    previous: dict[tuple[str, str], SyndromeBatch] = {}
    profiles: dict[tuple[str, str], tuple[object, ...]] = {}
    for value in values:
        if type(value) is SyndromeBatch and not getattr(value, "provenance_id", None):
            failures.add("batch_provenance_absent", "batch omitted provenance identity")
        batch = _canonical_batch(value, failures)
        if batch is None:
            continue
        key = batch.session_id, batch.segment_id
        _check_batch_sequence(batch, previous.get(key), failures)
        previous[key] = batch
        profile = _batch_schema_profile(batch)
        expected_profile = profiles.setdefault(key, profile)
        if profile != expected_profile:
            failures.add(
                "batch_schema_profile_changed", "schema changed within a segment"
            )
        if batch.detector_events.bit_width != expected_profile[0]:
            failures.add(
                "batch_width_changed", "detector width changed within a segment"
            )
        if provenance_id and batch.provenance_id != provenance_id:
            failures.add(
                "batch_provenance_mismatch", "batch provenance mismatched validation"
            )
        if expected_provenance_id and batch.provenance_id != expected_provenance_id:
            failures.add(
                "batch_mapping_provenance_mismatch",
                "batch provenance mismatched the import mapping",
            )


def _check_preview(
    first: object,
    second: object,
    source_hash: str,
    provenance_id: str | None,
    expected_provenance_id: str | None,
    failures: _FailureCollector,
) -> None:
    if isinstance(first, UnsupportedCapabilityResult):
        failures.add(
            "preview_unsupported_invalid", "preview is a mandatory core capability"
        )
        return
    if type(first) is not PreviewResult or type(second) is not PreviewResult:
        failures.add("preview_result_invalid", "preview did not return PreviewResult")
        return
    if first != second:
        failures.add("preview_nondeterministic", "identical preview calls differed")
    records = sum(batch.record_count for batch in first.batches)
    if records > PREVIEW_LIMIT or len(first.batches) > PREVIEW_LIMIT:
        failures.add("preview_limit_exceeded", "preview exceeded the requested limit")
    if first.source_sha256 != source_hash:
        failures.add("preview_source_hash_mismatch", "preview source hash mismatched")
    if not first.provenance_id:
        failures.add("preview_provenance_absent", "preview omitted provenance identity")
    elif provenance_id and first.provenance_id != provenance_id:
        failures.add(
            "preview_provenance_mismatch", "preview provenance mismatched validation"
        )
    if expected_provenance_id and first.provenance_id != expected_provenance_id:
        failures.add(
            "preview_mapping_provenance_mismatch",
            "preview provenance mismatched the import mapping",
        )
    _check_batches(
        tuple(first.batches), provenance_id, expected_provenance_id, failures
    )


def _consume_import(
    value: object, failures: _FailureCollector, stages: _StageReporter
) -> tuple[object, ...]:
    if isinstance(value, UnsupportedCapabilityResult):
        failures.add(
            "import_unsupported_invalid", "import is a mandatory core capability"
        )
        return ()
    if not isinstance(value, Iterator):
        failures.add(
            "import_result_invalid", "import_batches did not return an iterator"
        )
        return ()
    batches: list[object] = []
    stages.set("import_iteration")
    try:
        for _ in range(IMPORT_BATCH_LIMIT):
            try:
                batches.append(next(value))
            except StopIteration:
                break
    except BaseException as error:
        failures.add("import_iteration_raised", f"{type(error).__name__}: {error}")
    stages.set("import_close")
    try:
        close = getattr(value, "close", None)
        if callable(close):
            close()
    except BaseException as error:
        failures.add("import_close_raised", f"{type(error).__name__}: {error}")
    return tuple(batches)


def _check_import(
    adapter: object,
    source: Path,
    mapping: ImportMapping,
    provenance_id: str | None,
    failures: _FailureCollector,
    stages: _StageReporter,
) -> None:
    before = _snapshot_or_failure(source, failures, "import_snapshot_raised")
    stages.set("import_invocation")
    try:
        value = adapter.import_batches(source, mapping)
    except BaseException as error:
        failures.add("import_raised", f"{type(error).__name__}: {error}")
        value = None
    batches = _consume_import(value, failures, stages)
    after = _snapshot_or_failure(source, failures, "import_snapshot_raised")
    if before is not None and after is not None and before != after:
        failures.add("import_changed_source", "import changed the source")
    _check_batches(batches, provenance_id, mapping.expected_provenance_id, failures)


def _unsupported_for(value: object, capability: AdapterCapability) -> bool:
    return type(value) is UnsupportedCapabilityResult and value.capability is capability


async def _resolve_async(value: object) -> object:
    return await value if inspect.isawaitable(value) else value


async def _consume_stream_iterator(
    stream: AsyncIterator[object],
    failures: _FailureCollector,
    stages: _StageReporter,
) -> tuple[object, ...]:
    batches: list[object] = []
    stages.set("stream_iteration")
    try:
        async for batch in stream:
            batches.append(batch)
            if len(batches) >= IMPORT_BATCH_LIMIT:
                break
    except AdapterCancelled:
        pass
    except BaseException as error:
        failures.add("stream_iteration_raised", f"{type(error).__name__}: {error}")
    stages.set("stream_close")
    try:
        close = getattr(stream, "aclose", None)
        if callable(close):
            await close()
    except BaseException as error:
        failures.add("stream_close_raised", f"{type(error).__name__}: {error}")
    return tuple(batches)


def _stream_method(adapter: object, failures: _FailureCollector) -> object | None:
    try:
        method = getattr(adapter, "stream_batches")
        if len(inspect.signature(method).parameters) != 1:
            failures.add(
                "stream_missing_cancellation", "stream must accept StreamConfig"
            )
        return method
    except BaseException as error:
        failures.add("stream_signature_raised", f"{type(error).__name__}: {error}")
        return None


async def _check_stream(
    adapter: object,
    manifest: AdapterManifest,
    failures: _FailureCollector,
    stages: _StageReporter,
) -> None:
    stages.set("stream_signature")
    method = _stream_method(adapter, failures)
    if method is None:
        return
    cancel = _ObservedCancelled()
    stages.set("stream_invocation")
    try:
        value = method(StreamConfig(manifest.source_kinds[0], cancel=cancel))
        resolved = await _resolve_async(value)
    except AdapterCancelled:
        resolved = None
    except BaseException as error:
        failures.add("stream_raised", f"{type(error).__name__}: {error}")
        return
    declared = AdapterCapability.STREAM in manifest.capabilities
    if isinstance(resolved, UnsupportedCapabilityResult):
        if not _unsupported_for(resolved, AdapterCapability.STREAM):
            failures.add(
                "unsupported_capability_mismatch",
                "stream unsupported result mismatched",
            )
        elif declared:
            failures.add(
                "declared_capability_unsupported", "declared stream is unsupported"
            )
        return
    if not declared:
        failures.add(
            "undeclared_capability_available", "stream is available but undeclared"
        )
    if resolved is None:
        return
    if not isinstance(resolved, AsyncIterator):
        failures.add("stream_result_invalid", "stream did not return an async iterator")
        return
    batches = await _consume_stream_iterator(resolved, failures, stages)
    if declared and not cancel.observed:
        failures.add(
            "stream_missing_cancellation", "stream ignored its cancellation token"
        )
    if declared and batches:
        failures.add("stream_ignored_cancellation", "stream yielded after cancellation")


async def _check_command(
    adapter: object,
    manifest: AdapterManifest,
    failures: _FailureCollector,
    stages: _StageReporter,
) -> None:
    stages.set("command")
    try:
        result = await _resolve_async(
            adapter.command(AdapterCommand("contract.health"))
        )
    except BaseException as error:
        failures.add("command_raised", f"{type(error).__name__}: {error}")
        return
    declared = AdapterCapability.COMMAND in manifest.capabilities
    if isinstance(result, UnsupportedCapabilityResult):
        if not _unsupported_for(result, AdapterCapability.COMMAND):
            failures.add(
                "unsupported_capability_mismatch",
                "command unsupported result mismatched",
            )
        elif declared:
            failures.add(
                "declared_capability_unsupported", "declared command is unsupported"
            )
        return
    if not declared:
        failures.add(
            "undeclared_capability_available", "command is available but undeclared"
        )
    if type(result) is not CommandSuccessResult:
        failures.add("command_result_invalid", "command did not return CommandResult")


async def _check_live(
    adapter: object,
    manifest: AdapterManifest,
    failures: _FailureCollector,
    stages: _StageReporter,
) -> None:
    await _check_stream(adapter, manifest, failures, stages)
    await _check_command(adapter, manifest, failures, stages)
    stages.set("event_loop_shutdown")


def _check_offline(
    adapter: object,
    manifest: AdapterManifest,
    source: Path,
    failures: _FailureCollector,
    stages: _StageReporter,
) -> None:
    mapping = ImportMapping(expected_provenance_id="contract-provenance")
    source_hash = compute_source_sha256(source)
    probe = _call_read_only(
        "probe", source, lambda: adapter.probe(source), failures, stages
    )
    _check_probe(probe, manifest, source_hash, failures)
    validation = _call_read_only(
        "validate", source, lambda: adapter.validate(source, mapping), failures, stages
    )
    provenance_id = _check_validation(
        validation, source_hash, mapping.expected_provenance_id, failures
    )
    previews = tuple(
        _call_read_only(
            "preview",
            source,
            lambda: adapter.preview(source, mapping, PREVIEW_LIMIT),
            failures,
            stages,
        )
        for _ in range(2)
    )
    _check_preview(
        *previews,
        source_hash,
        provenance_id,
        mapping.expected_provenance_id,
        failures,
    )
    _check_import(adapter, source, mapping, provenance_id, failures, stages)


def _run_contract(
    adapter_factory: Callable[[], AdapterLike], source: Path, stages: _StageReporter
) -> AdapterContractReport:
    failures = _FailureCollector()
    stages.set("source_snapshot")
    initial = _snapshot_or_failure(source, failures, "source_snapshot_raised")
    if initial is None:
        return failures.report()
    stages.set("factory")
    try:
        adapter = adapter_factory()
    except BaseException as error:
        failures.add("adapter_factory_raised", f"{type(error).__name__}: {error}")
        return failures.report()
    stages.set("manifest")
    manifest = _manifest(adapter, failures)
    if manifest is None:
        return failures.report()
    _check_required_methods(adapter, failures)
    _check_offline(adapter, manifest, source, failures, stages)
    try:
        asyncio.run(_check_live(adapter, manifest, failures, stages))
    except BaseException as error:
        failures.add("event_loop_raised", f"{type(error).__name__}: {error}")
    stages.set("final_source_snapshot")
    final = _snapshot_or_failure(source, failures, "final_source_snapshot_raised")
    if final is not None and final != initial:
        failures.add("source_changed", "adapter changed source data or metadata")
    return failures.report()


def _safe_send(connection: object, message: tuple[str, object]) -> None:
    try:
        connection.send(message)
    except BaseException:
        return


def _child_main(
    connection: object,
    adapter_factory: object,
    source: Path,
    isolation_backend: IsolationBackend,
) -> None:
    isolation_token, isolation_error = isolation_backend.prepare_worker()
    if isolation_error is not None:
        report = AdapterContractReport(
            (ContractFailure("isolation_unavailable", isolation_error),)
        )
        _safe_send(connection, ("report", report))
        connection.close()
        return
    _safe_send(connection, ("isolation_ready", isolation_token))
    stages = _StageReporter(lambda message: _safe_send(connection, message))
    try:
        report = _run_contract(adapter_factory, source, stages)
    except BaseException as error:
        report = AdapterContractReport(
            (
                ContractFailure(
                    f"{stages.current}_raised", f"{type(error).__name__}: {error}"
                ),
            )
        )
    _safe_send(connection, ("report", report))
    try:
        connection.close()
    except BaseException:
        return


def _timeout_code(stage: str) -> str:
    aliases = {
        "factory": "adapter_factory_timed_out",
        "import_invocation": "import_timed_out",
    }
    return aliases.get(stage, f"{stage}_timed_out")


def _merge_parent_failure(
    report: AdapterContractReport, failure: ContractFailure | None
) -> AdapterContractReport:
    if failure is None or failure.code in report.failure_codes:
        return report
    return AdapterContractReport((*report.failures, failure))


def _execute_worker(
    context: multiprocessing.context.BaseContext,
    adapter_factory: object,
    source: Path,
    deadline: float,
    isolation_backend: IsolationBackend,
) -> tuple[AdapterContractReport | None, str, bool, ContractFailure | None]:
    parent, child = context.Pipe(duplex=False)
    process = context.Process(
        target=_child_main,
        args=(child, adapter_factory, source, isolation_backend),
    )
    try:
        process.start()
    except BaseException as error:
        parent.close()
        child.close()
        report = AdapterContractReport(
            (
                ContractFailure(
                    "isolation_unavailable", f"{type(error).__name__}: {error}"
                ),
            )
        )
        return report, "startup", False, None
    child.close()
    received, stage, isolation_token = receive_worker_report(
        parent, process, deadline, AdapterContractReport
    )
    report = received if type(received) is AdapterContractReport else None
    process.join(max(0.0, deadline - time.monotonic()))
    timed_out = report is None and process.is_alive()
    cleanup_error = isolation_backend.cleanup_worker(process, isolation_token)
    cleanup_failure = (
        ContractFailure("isolation_cleanup_failed", cleanup_error)
        if cleanup_error is not None
        else None
    )
    if process.exitcode is not None:
        process.close()
    parent.close()
    return report, stage, timed_out, cleanup_failure


def _source_change_failure(
    initial: tuple[object, ...],
    final: tuple[object, ...] | None,
    error: tuple[str, str] | None,
    stage: str,
) -> ContractFailure | None:
    if final is None:
        return ContractFailure("final_source_snapshot_raised", repr(error))
    if final != initial:
        return ContractFailure(f"{stage}_changed_source", "worker changed the source")
    return None


def run_adapter_contract(
    adapter_factory: Callable[[], AdapterLike],
    source: Path,
    isolation_backend: IsolationBackend | None = None,
) -> AdapterContractReport:
    """Run under an injected backend or fail closed without secure containment."""

    outer_deadline = time.monotonic() + CONTRACT_TIMEOUT_SECONDS
    snapshot_context = multiprocessing.get_context(
        "fork" if "fork" in multiprocessing.get_all_start_methods() else "spawn"
    )
    initial, initial_error = bounded_source_snapshot(
        snapshot_context,
        source,
        min(outer_deadline, time.monotonic() + SNAPSHOT_TIMEOUT_SECONDS),
    )
    if initial is None:
        error_name, message = initial_error or ("SnapshotError", "unknown error")
        code = "source_symlink_rejected" if "symlink" in message else "source_invalid"
        return AdapterContractReport(
            (ContractFailure(code, f"{error_name}: {message}"),)
        )
    backend, context, isolation_error = resolve_isolation_backend(
        adapter_factory, isolation_backend, os.name
    )
    if backend is None or context is None:
        return AdapterContractReport(
            (
                ContractFailure(
                    "isolation_unavailable",
                    isolation_error or "isolation backend resolution failed",
                ),
            )
        )
    worker_deadline = outer_deadline - SNAPSHOT_TIMEOUT_SECONDS
    report, stage, timed_out, cleanup_failure = _execute_worker(
        context, adapter_factory, source, worker_deadline, backend
    )
    if report is None:
        code = _timeout_code(stage) if timed_out else "worker_exited"
        report = AdapterContractReport(
            (ContractFailure(code, f"worker stopped during {stage}"),)
        )
    report = _merge_parent_failure(report, cleanup_failure)
    final, final_error = bounded_source_snapshot(
        snapshot_context, source, outer_deadline
    )
    parent_failure = _source_change_failure(initial, final, final_error, stage)
    return _merge_parent_failure(report, parent_failure)
