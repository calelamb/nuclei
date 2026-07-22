import asyncio
import inspect
import multiprocessing
import os
import time
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

from kernel.qec_data.adapters.base import (
    AdapterCapability,
    AdapterCancelled,
    AdapterCommand,
    AdapterManifest,
    AlreadyCancelled,
    CommandSuccessResult,
    ImportMapping,
    PreviewResult,
    ProbeResult,
    QecDataAdapter,
    StreamConfig,
    ValidationReport,
    ValidationIssue,
    compute_source_sha256,
    fingerprint_source,
    unsupported,
)
from kernel.qec_data.adapters.registry import (
    AdapterRegistrationError,
    AdapterRegistry,
)
from kernel.qec_data.models import PackedBits, SyndromeBatch
from kernel.qec_data.models import (
    QualifiedTimestamps,
    TimestampSeries,
    ValueStatus,
)
from kernel.tests.qec_data.adapter_contract import (
    factory_is_spawn_importable,
    run_adapter_contract,
)


PROVENANCE_ID = "contract-provenance"
OFFLINE_CAPABILITIES = frozenset(
    {
        AdapterCapability.PROBE,
        AdapterCapability.VALIDATE,
        AdapterCapability.PREVIEW,
        AdapterCapability.IMPORT,
    }
)


def canonical_batch(
    sequence_start: int = 0,
    *,
    record_count: int = 1,
    detector_width: int = 1,
    provenance_id: str = PROVENANCE_ID,
) -> SyndromeBatch:
    bytes_per_record = (detector_width + 7) // 8
    return SyndromeBatch(
        batch_id=f"batch-{sequence_start}-{detector_width}",
        session_id="session-1",
        segment_id="segment-1",
        sequence_start=sequence_start,
        sequence_end=sequence_start + record_count,
        record_count=record_count,
        detector_events=PackedBits(
            bit_width=detector_width,
            data=bytes(bytes_per_record * record_count),
        ),
        provenance_id=provenance_id,
    )


class GoodAdapter:
    manifest = AdapterManifest(
        id="test.good",
        version="1.0.0",
        capabilities=OFFLINE_CAPABILITIES,
        source_kinds=("stim-dets",),
    )

    def probe(self, source: Path) -> ProbeResult:
        return ProbeResult(
            supported=True,
            source_kind="stim-dets",
            source_sha256=compute_source_sha256(source),
        )

    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport:
        return ValidationReport(
            valid=True,
            source_sha256=compute_source_sha256(source),
            provenance_id=PROVENANCE_ID,
        )

    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        return PreviewResult(
            batches=(canonical_batch(),) if limit else (),
            truncated=True,
            total_records=2,
            source_sha256=compute_source_sha256(source),
            provenance_id=PROVENANCE_ID,
        )

    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter((canonical_batch(0), canonical_batch(1)))

    async def stream_batches(self, config: StreamConfig):
        return unsupported(AdapterCapability.STREAM)

    async def command(self, command: AdapterCommand):
        return unsupported(AdapterCapability.COMMAND)


class MutatingProbeAdapter(GoodAdapter):
    def probe(self, source: Path) -> ProbeResult:
        source.write_text("changed\n", encoding="utf-8")
        return super().probe(source)


class MetadataMutatingProbeAdapter(GoodAdapter):
    def probe(self, source: Path) -> ProbeResult:
        result = super().probe(source)
        stat = source.stat()
        os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
        return result


class NondeterministicPreviewAdapter(GoodAdapter):
    def __init__(self) -> None:
        self.calls = 0

    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        self.calls += 1
        return replace(
            super().preview(source, mapping, limit), total_records=self.calls
        )


class OverLimitPreviewAdapter(GoodAdapter):
    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        return replace(
            super().preview(source, mapping, limit),
            batches=(canonical_batch(record_count=limit + 1),),
            total_records=limit + 1,
        )


class HangingPreviewAdapter(GoodAdapter):
    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        time.sleep(5)
        return super().preview(source, mapping, limit)


class OverlappingSequenceAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter((canonical_batch(0, record_count=2), canonical_batch(1)))


class NonmonotonicSequenceAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter((canonical_batch(2), canonical_batch(1)))


class WidthChangingAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter(
            (canonical_batch(0, detector_width=1), canonical_batch(1, detector_width=9))
        )


class MismatchedProvenanceAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter((canonical_batch(provenance_id="other-provenance"),))


class MissingBatchProvenanceAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        batch = canonical_batch()
        object.__setattr__(batch, "provenance_id", "")
        return iter((batch,))


class InvalidRecordInvariantAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        batch = canonical_batch()
        object.__setattr__(batch, "record_count", 2)
        return iter((batch,))


class MissingValidationProvenanceAdapter(GoodAdapter):
    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport:
        return ValidationReport(valid=True, source_sha256=compute_source_sha256(source))


async def _empty_stream():
    if False:
        yield canonical_batch()


class MissingCancellationAdapter(GoodAdapter):
    manifest = replace(
        GoodAdapter.manifest,
        id="broken.no-cancel",
        capabilities=OFFLINE_CAPABILITIES | {AdapterCapability.STREAM},
    )

    async def stream_batches(self, config: StreamConfig):
        return _empty_stream()


class MissingStreamConfigAdapter(MissingCancellationAdapter):
    manifest = replace(MissingCancellationAdapter.manifest, id="broken.no-config")

    async def stream_batches(self):
        return _empty_stream()


class CancelAwareAdapter(MissingCancellationAdapter):
    manifest = replace(MissingCancellationAdapter.manifest, id="test.cancel-aware")

    async def stream_batches(self, config: StreamConfig):
        config.cancel.raise_if_cancelled()
        return _empty_stream()


class HangingStreamAdapter(MissingCancellationAdapter):
    manifest = replace(MissingCancellationAdapter.manifest, id="broken.hanging-stream")

    async def stream_batches(self, config: StreamConfig):
        config.cancel.is_cancelled
        await asyncio.sleep(5)
        return _empty_stream()


class DeclaredUnsupportedCommandAdapter(GoodAdapter):
    manifest = replace(
        GoodAdapter.manifest,
        id="broken.command",
        capabilities=OFFLINE_CAPABILITIES | {AdapterCapability.COMMAND},
    )


class HangingCommandAdapter(GoodAdapter):
    manifest = replace(
        GoodAdapter.manifest,
        id="broken.hanging-command",
        capabilities=OFFLINE_CAPABILITIES | {AdapterCapability.COMMAND},
    )

    async def command(self, command: AdapterCommand):
        await asyncio.sleep(5)
        return CommandSuccessResult()


class InvalidBatchAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter((object(),))


class MutatingImportAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        source.write_text("rewritten by import\n", encoding="utf-8")
        yield canonical_batch()


class UnboundedImportAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        sequence = 0
        while True:
            yield canonical_batch(sequence)
            sequence += 1


class NonYieldingImportAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        time.sleep(5)
        if False:
            yield canonical_batch()


class ChildProcessOnlyAdapter(GoodAdapter):
    def probe(self, source: Path) -> ProbeResult:
        parent_pid = int(source.read_text(encoding="utf-8"))
        if os.getpid() == parent_pid:
            raise RuntimeError("adapter executed in the trusted parent process")
        return super().probe(source)


class LongHangingPreviewAdapter(GoodAdapter):
    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        time.sleep(5)
        return super().preview(source, mapping, limit)


class ExplodingManifestAdapter(GoodAdapter):
    @property
    def manifest(self):
        raise RuntimeError("manifest getter exploded")


class GapSequenceAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter((canonical_batch(0), canonical_batch(2)))


class InvalidPaddingAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        batch = canonical_batch(detector_width=1)
        object.__setattr__(batch.detector_events, "data", b"\x80")
        return iter((batch,))


class OfflineUnsupportedAdapter(GoodAdapter):
    def validate(self, source: Path, mapping: ImportMapping):
        return unsupported(AdapterCapability.VALIDATE)


class CloseRaisingIterator:
    def __iter__(self):
        return self

    def __next__(self):
        raise StopIteration

    def close(self) -> None:
        raise RuntimeError("close exploded")


class CloseRaisingAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return CloseRaisingIterator()


class InvalidRangeAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        batch = canonical_batch()
        object.__setattr__(batch, "sequence_start", -1)
        return iter((batch,))


class InvalidTimestampAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        batch = canonical_batch()
        timestamps = QualifiedTimestamps(
            TimestampSeries((1.0, 2.0), "ns"), ValueStatus.MEASURED
        )
        object.__setattr__(batch, "source_timestamps", timestamps)
        return iter((batch,))


class InvalidQualityAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        batch = canonical_batch()
        object.__setattr__(batch, "data_quality", ())
        return iter((batch,))


class InvalidSchemaAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        batch = canonical_batch()
        object.__setattr__(batch, "schema_version", "2.0.0")
        return iter((batch,))


class SignatureBomb:
    @property
    def __signature__(self):
        raise RuntimeError("signature exploded")

    def __call__(self, config: StreamConfig):
        return unsupported(AdapterCapability.STREAM)


class ExplodingSignatureAdapter(GoodAdapter):
    stream_batches = SignatureBomb()


async def _stubborn_task() -> None:
    while True:
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            continue


class EventLoopShutdownAdapter(GoodAdapter):
    async def command(self, command: AdapterCommand):
        asyncio.create_task(_stubborn_task())
        return unsupported(AdapterCapability.COMMAND)


def hanging_factory():
    time.sleep(5)
    return GoodAdapter()


@pytest.fixture
def source(tmp_path: Path) -> Path:
    path = tmp_path / "source.dets"
    path.write_text("shot D0\n", encoding="utf-8")
    return path


def test_source_fingerprint_tracks_file_and_directory_metadata(
    source: Path, tmp_path: Path
) -> None:
    file_fingerprint = fingerprint_source(source)
    assert len(file_fingerprint) == 1
    assert file_fingerprint[0].relative_path == "."
    assert file_fingerprint[0].content_sha256 == compute_source_sha256(source)

    directory = tmp_path / "dataset"
    directory.mkdir()
    child = directory / "records.dets"
    child.write_text("shot D1\n", encoding="utf-8")
    entries = fingerprint_source(directory)
    assert [(entry.relative_path, entry.kind) for entry in entries] == [
        (".", "directory"),
        ("records.dets", "file"),
    ]


BROKEN_CASES = (
    (MutatingProbeAdapter, "probe_changed_source"),
    (MetadataMutatingProbeAdapter, "probe_changed_source"),
    (NondeterministicPreviewAdapter, "preview_nondeterministic"),
    (OverLimitPreviewAdapter, "preview_limit_exceeded"),
    (HangingPreviewAdapter, "preview_timed_out"),
    (OverlappingSequenceAdapter, "batch_sequence_overlap"),
    (NonmonotonicSequenceAdapter, "batch_sequence_nonmonotonic"),
    (WidthChangingAdapter, "batch_width_changed"),
    (MismatchedProvenanceAdapter, "batch_provenance_mismatch"),
    (MissingBatchProvenanceAdapter, "batch_provenance_absent"),
    (InvalidRecordInvariantAdapter, "batch_canonical_invalid"),
    (MissingValidationProvenanceAdapter, "validation_provenance_absent"),
    (MissingCancellationAdapter, "stream_missing_cancellation"),
    (MissingStreamConfigAdapter, "stream_missing_cancellation"),
    (HangingStreamAdapter, "stream_invocation_timed_out"),
    (DeclaredUnsupportedCommandAdapter, "declared_capability_unsupported"),
    (HangingCommandAdapter, "command_timed_out"),
    (InvalidBatchAdapter, "batch_type_invalid"),
    (MutatingImportAdapter, "import_changed_source"),
    (NonYieldingImportAdapter, "import_iteration_timed_out"),
)


def test_good_offline_adapter_passes_contract(source: Path) -> None:
    assert run_adapter_contract(GoodAdapter, source).passed


def test_cancel_aware_stream_adapter_passes_contract(source: Path) -> None:
    assert run_adapter_contract(CancelAwareAdapter, source).passed


@pytest.mark.parametrize(
    ("adapter_factory", "failure_code"),
    BROKEN_CASES,
)
def test_broken_adapters_return_stable_failure_codes(
    source: Path, adapter_factory, failure_code: str
) -> None:
    report = run_adapter_contract(adapter_factory, source)
    assert failure_code in report.failure_codes


def test_broken_adapter_failure_codes_are_deterministic(tmp_path: Path) -> None:
    slow = {
        HangingPreviewAdapter,
        HangingStreamAdapter,
        HangingCommandAdapter,
        NonYieldingImportAdapter,
    }
    for index, (adapter_factory, _) in enumerate(BROKEN_CASES):
        if adapter_factory in slow:
            continue
        codes: list[tuple[str, ...]] = []
        for repetition in range(2):
            source = tmp_path / f"{index}-{repetition}.dets"
            source.write_text("shot D0\n", encoding="utf-8")
            codes.append(run_adapter_contract(adapter_factory, source).failure_codes)
        assert codes[0] == codes[1], adapter_factory.__name__


def test_broken_factory_and_methods_do_not_crash_contract(source: Path) -> None:
    def broken_factory():
        raise RuntimeError("plugin import failed")

    report = run_adapter_contract(broken_factory, source)
    assert report.failure_codes == ("adapter_factory_raised",)


def test_missing_source_returns_failure_instead_of_crashing(tmp_path: Path) -> None:
    report = run_adapter_contract(GoodAdapter, tmp_path / "missing.dets")
    assert report.failure_codes == ("source_invalid",)


def test_unsupported_results_are_typed_and_frozen() -> None:
    result = unsupported(AdapterCapability.COMMAND)
    assert result.code == "unsupported_capability"
    with pytest.raises(FrozenInstanceError):
        result.message = "changed"  # type: ignore[misc]


def test_manifest_and_mapping_validate_immutable_boundary_values() -> None:
    with pytest.raises(FrozenInstanceError):
        GoodAdapter.manifest.version = "2.0.0"  # type: ignore[misc]
    with pytest.raises(TypeError, match="frozenset"):
        replace(GoodAdapter.manifest, capabilities={AdapterCapability.PROBE})  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="unique"):
        replace(GoodAdapter.manifest, source_kinds=("dets", "dets"))
    with pytest.raises(TypeError, match="tuple"):
        ImportMapping(fields={"detectors": "events"})  # type: ignore[arg-type]


def test_registry_is_immutable_and_rejects_duplicate_identity() -> None:
    empty = AdapterRegistry()
    first = empty.register(GoodAdapter())
    assert empty.adapters == ()
    assert first.get("test.good", "1.0.0").manifest.id == "test.good"
    with pytest.raises(AdapterRegistrationError, match="already registered"):
        first.register(GoodAdapter())


def test_registry_requires_explicit_version_when_id_has_multiple_versions() -> None:
    registry = AdapterRegistry().register(GoodAdapter())
    version_two = GoodAdapter()
    version_two.manifest = replace(GoodAdapter.manifest, version="2.0.0")
    registry = registry.register(version_two)
    with pytest.raises(KeyError, match="explicit version"):
        registry.get("test.good")
    assert registry.get("test.good", "2.0.0") is version_two


def test_registry_rejects_invalid_manifest_and_missing_methods() -> None:
    invalid = object()
    with pytest.raises(AdapterRegistrationError, match="manifest"):
        AdapterRegistry().register(invalid)  # type: ignore[arg-type]

    forged_manifest = object.__new__(AdapterManifest)
    object.__setattr__(forged_manifest, "id", "")
    object.__setattr__(forged_manifest, "version", "1")
    object.__setattr__(forged_manifest, "capabilities", frozenset())
    object.__setattr__(forged_manifest, "source_kinds", ("dets",))
    forged_adapter = GoodAdapter()
    forged_adapter.manifest = forged_manifest
    with pytest.raises(AdapterRegistrationError, match="manifest is invalid"):
        AdapterRegistry().register(forged_adapter)

    class MissingMethods:
        manifest = GoodAdapter.manifest

    with pytest.raises(AdapterRegistrationError, match="missing required methods"):
        AdapterRegistry().register(MissingMethods())  # type: ignore[arg-type]
    with pytest.raises(AdapterRegistrationError, match="registration record"):
        AdapterRegistry(registrations=(MissingMethods(),))  # type: ignore[arg-type]


def test_command_success_dto_is_frozen_and_validated() -> None:
    result = CommandSuccessResult(details=(("healthy", True),))
    assert result.code == "ok"
    with pytest.raises(ValueError, match="unique"):
        CommandSuccessResult(details=(("state", "up"), ("state", "down")))


def test_cancel_token_is_compatible_with_stream_config() -> None:
    config = StreamConfig("synthetic", cancel=AlreadyCancelled())
    assert config.cancel.is_cancelled is True
    with pytest.raises(AdapterCancelled):
        config.cancel.raise_if_cancelled()
    asyncio.run(GoodAdapter().command(AdapterCommand("health")))


def test_protocol_preserves_frozen_master_method_signatures() -> None:
    expected = {
        "probe": ("self", "source"),
        "validate": ("self", "source", "mapping"),
        "preview": ("self", "source", "mapping", "limit"),
        "import_batches": ("self", "source", "mapping"),
        "stream_batches": ("self", "config"),
        "command": ("self", "command"),
    }
    for method_name, parameters in expected.items():
        method = getattr(QecDataAdapter, method_name)
        assert tuple(inspect.signature(method).parameters) == parameters
    assert isinstance(GoodAdapter(), QecDataAdapter)


def test_directory_source_hash_is_deterministic_and_content_sensitive(
    tmp_path: Path,
) -> None:
    source = tmp_path / "capture"
    source.mkdir()
    (source / "a.dets").write_bytes(b"a")
    first = compute_source_sha256(source)
    assert first == compute_source_sha256(source)
    (source / "a.dets").write_bytes(b"b")
    assert compute_source_sha256(source) != first


def test_source_hash_rejects_symlink_source_and_children(tmp_path: Path) -> None:
    target = tmp_path / "target.dets"
    target.write_text("D0\n", encoding="utf-8")
    linked_source = tmp_path / "linked.dets"
    linked_source.symlink_to(target)
    with pytest.raises(ValueError, match="symlink"):
        compute_source_sha256(linked_source)

    source_dir = tmp_path / "capture"
    source_dir.mkdir()
    (source_dir / "linked.dets").symlink_to(target)
    with pytest.raises(ValueError, match="symlink"):
        compute_source_sha256(source_dir)
    assert run_adapter_contract(GoodAdapter, linked_source).failure_codes == (
        "source_symlink_rejected",
    )


def test_contract_runs_adapter_in_child_process_and_reaps_it(tmp_path: Path) -> None:
    source = tmp_path / "source.dets"
    source.write_text(str(os.getpid()), encoding="utf-8")
    before = {process.pid for process in multiprocessing.active_children()}
    report = run_adapter_contract(ChildProcessOnlyAdapter, source)
    after = {process.pid for process in multiprocessing.active_children()}
    assert report.passed
    assert after == before


def test_contract_terminates_hanging_worker_without_leaking_processes(
    source: Path,
) -> None:
    before = {process.pid for process in multiprocessing.active_children()}
    started = time.monotonic()
    report = run_adapter_contract(LongHangingPreviewAdapter, source)
    elapsed = time.monotonic() - started
    after = {process.pid for process in multiprocessing.active_children()}
    assert "preview_timed_out" in report.failure_codes
    assert elapsed < 4.0
    assert after == before


def test_registry_detects_live_manifest_drift_before_dispatch() -> None:
    adapter = GoodAdapter()
    registry = AdapterRegistry().register(adapter)
    adapter.manifest = replace(
        adapter.manifest,
        capabilities=adapter.manifest.capabilities | {AdapterCapability.COMMAND},
    )
    with pytest.raises(AdapterRegistrationError, match="manifest.*changed"):
        registry.get("test.good", "1.0.0")


def test_large_import_is_sampled_without_being_called_unbounded(source: Path) -> None:
    report = run_adapter_contract(UnboundedImportAdapter, source)
    assert "import_sample_unbounded" not in report.failure_codes


@pytest.mark.parametrize(
    ("adapter_factory", "failure_code"),
    [
        (GapSequenceAdapter, "batch_sequence_gap"),
        (InvalidPaddingAdapter, "batch_canonical_invalid"),
        (CloseRaisingAdapter, "import_close_raised"),
        (OfflineUnsupportedAdapter, "validate_unsupported_invalid"),
        (InvalidRangeAdapter, "batch_canonical_invalid"),
        (InvalidTimestampAdapter, "batch_canonical_invalid"),
        (InvalidQualityAdapter, "batch_canonical_invalid"),
        (InvalidSchemaAdapter, "batch_canonical_invalid"),
        (ExplodingSignatureAdapter, "stream_signature_raised"),
    ],
)
def test_adversarial_adapter_errors_are_precise(
    source: Path, adapter_factory, failure_code: str
) -> None:
    report = run_adapter_contract(adapter_factory, source)
    assert failure_code in report.failure_codes


def test_manifest_getter_exception_becomes_stable_failure(source: Path) -> None:
    try:
        report = run_adapter_contract(ExplodingManifestAdapter, source)
    except Exception as error:  # pragma: no cover - this is the regression
        pytest.fail(f"contract propagated manifest error: {error}")
    assert report.failure_codes == ("manifest_raised",)


def test_core_capabilities_are_mandatory_and_never_unsupported() -> None:
    with pytest.raises(ValueError, match="core capabilities"):
        replace(
            GoodAdapter.manifest,
            capabilities=frozenset({AdapterCapability.PROBE}),
        )


def test_metadata_rejects_nonfinite_nested_values_and_enum_strings() -> None:
    with pytest.raises(ValueError, match="finite"):
        AdapterCommand("configure", parameters=(("nested", (1.0, float("inf"))),))
    with pytest.raises(TypeError, match="ValidationSeverity"):
        ValidationIssue("bad", "bad", severity="error")  # type: ignore[arg-type]


def test_spawn_factory_requirement_is_explicit() -> None:
    assert factory_is_spawn_importable(GoodAdapter)
    assert not factory_is_spawn_importable(lambda: GoodAdapter())


@pytest.mark.parametrize(
    ("adapter_factory", "failure_code"),
    [
        (hanging_factory, "adapter_factory_timed_out"),
        (EventLoopShutdownAdapter, "event_loop_shutdown_timed_out"),
    ],
)
def test_outer_deadline_covers_factory_and_event_loop_shutdown(
    source: Path, adapter_factory, failure_code: str
) -> None:
    before = {process.pid for process in multiprocessing.active_children()}
    report = run_adapter_contract(adapter_factory, source)
    after = {process.pid for process in multiprocessing.active_children()}
    assert failure_code in report.failure_codes
    assert after == before
