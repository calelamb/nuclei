import asyncio
import inspect
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
    compute_source_sha256,
    unsupported,
)
from kernel.qec_data.adapters.registry import (
    AdapterRegistrationError,
    AdapterRegistry,
)
from kernel.qec_data.models import PackedBits, SyndromeBatch
from kernel.tests.qec_data.adapter_contract import run_adapter_contract


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


class ProbeOnlyAdapter(GoodAdapter):
    manifest = replace(
        GoodAdapter.manifest,
        id="test.probe-only",
        capabilities=frozenset({AdapterCapability.PROBE}),
    )

    def validate(self, source: Path, mapping: ImportMapping):
        return unsupported(AdapterCapability.VALIDATE)

    def preview(self, source: Path, mapping: ImportMapping, limit: int):
        return unsupported(AdapterCapability.PREVIEW)

    def import_batches(self, source: Path, mapping: ImportMapping):
        return unsupported(AdapterCapability.IMPORT)


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
        time.sleep(0.5)
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
        await asyncio.sleep(0.5)
        return _empty_stream()


class UndeclaredPreviewAdapter(GoodAdapter):
    manifest = replace(
        GoodAdapter.manifest,
        id="broken.undeclared-preview",
        capabilities=OFFLINE_CAPABILITIES - {AdapterCapability.PREVIEW},
    )


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
        await asyncio.sleep(0.5)
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
        time.sleep(0.5)
        if False:
            yield canonical_batch()


@pytest.fixture
def source(tmp_path: Path) -> Path:
    path = tmp_path / "source.dets"
    path.write_text("shot D0\n", encoding="utf-8")
    return path


BROKEN_CASES = (
    (MutatingProbeAdapter, "probe_changed_source"),
    (MetadataMutatingProbeAdapter, "probe_changed_source"),
    (NondeterministicPreviewAdapter, "preview_nondeterministic"),
    (OverLimitPreviewAdapter, "preview_limit_exceeded"),
    (HangingPreviewAdapter, "preview_unbounded"),
    (OverlappingSequenceAdapter, "batch_sequence_overlap"),
    (NonmonotonicSequenceAdapter, "batch_sequence_nonmonotonic"),
    (WidthChangingAdapter, "batch_width_changed"),
    (MismatchedProvenanceAdapter, "batch_provenance_mismatch"),
    (MissingBatchProvenanceAdapter, "batch_provenance_absent"),
    (InvalidRecordInvariantAdapter, "batch_record_invariant_invalid"),
    (MissingValidationProvenanceAdapter, "validation_provenance_absent"),
    (MissingCancellationAdapter, "stream_missing_cancellation"),
    (MissingStreamConfigAdapter, "stream_missing_cancellation"),
    (HangingStreamAdapter, "stream_did_not_cancel"),
    (UndeclaredPreviewAdapter, "undeclared_capability_available"),
    (DeclaredUnsupportedCommandAdapter, "declared_capability_unsupported"),
    (HangingCommandAdapter, "command_timed_out"),
    (InvalidBatchAdapter, "batch_type_invalid"),
    (MutatingImportAdapter, "import_changed_source"),
    (UnboundedImportAdapter, "import_sample_unbounded"),
    (NonYieldingImportAdapter, "import_sample_unbounded"),
)


def test_good_offline_adapter_passes_contract(source: Path) -> None:
    assert run_adapter_contract(GoodAdapter, source).passed


def test_typed_unsupported_results_cover_every_undeclared_method(
    source: Path,
) -> None:
    assert run_adapter_contract(ProbeOnlyAdapter, source).passed


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
    for index, (adapter_factory, _) in enumerate(BROKEN_CASES):
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
    with pytest.raises(AdapterRegistrationError, match="missing required methods"):
        AdapterRegistry(adapters=(MissingMethods(),))  # type: ignore[arg-type]


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
