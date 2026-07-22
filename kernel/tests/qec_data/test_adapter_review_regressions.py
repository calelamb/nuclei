"""Adversarial regressions from the second adapter contract review."""

from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path
import subprocess
import sys
import time
from unittest.mock import Mock

import pytest

from kernel.qec_data.adapters.base import ImportMapping, PreviewResult, ValidationReport
from kernel.qec_data.model_validation import DataQualityFlag, ValueStatus
from kernel.qec_data.models import (
    IndexRange,
    PackedBits,
    QualifiedPackedBits,
    QualifiedRange,
    QualifiedTimestamps,
    TimestampSeries,
)
from kernel.tests.qec_data import adapter_contract as compliance
from kernel.tests.qec_data import adapter_process_isolation as isolation
from kernel.tests.qec_data.adapter_contract import run_adapter_contract
from kernel.tests.qec_data.test_adapter_contract import (
    GoodAdapter,
    canonical_batch,
)


OTHER_PROVENANCE = "unexpected-provenance"
TRUSTED_TEST_ISOLATION = compliance.trusted_process_group_backend()


@pytest.fixture
def source(tmp_path: Path) -> Path:
    path = tmp_path / "source.dets"
    path.write_text("shot D0\n", encoding="utf-8")
    return path


def run_trusted_contract(adapter_factory, source: Path):
    return run_adapter_contract(
        adapter_factory, source, isolation_backend=TRUSTED_TEST_ISOLATION
    )


class DelayedDescendantAdapter(GoodAdapter):
    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        marker = source.with_suffix(".descendants")
        script = (
            "import pathlib, sys, time; time.sleep(0.6); "
            "pathlib.Path(sys.argv[1]).write_text('escaped\\n')"
        )
        child = subprocess.Popen([sys.executable, "-c", script, str(source)])
        with marker.open("a", encoding="utf-8") as marker_file:
            marker_file.write(f"{child.pid}\n")
        return super().preview(source, mapping, limit)


class DetachedDescendantAdapter(GoodAdapter):
    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        script = (
            "import pathlib, sys, time; time.sleep(0.6); "
            "pathlib.Path(sys.argv[1]).write_text('detached-escape\\n')"
        )
        subprocess.Popen(
            [sys.executable, "-c", script, str(source)], start_new_session=True
        )
        return super().preview(source, mapping, limit)


class ValidationMappingMismatchAdapter(GoodAdapter):
    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport:
        return replace(
            super().validate(source, mapping), provenance_id=OTHER_PROVENANCE
        )


class PreviewMappingMismatchAdapter(GoodAdapter):
    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        return replace(
            super().preview(source, mapping, limit), provenance_id=OTHER_PROVENANCE
        )


class ImportMappingMismatchAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        return iter((canonical_batch(provenance_id=OTHER_PROVENANCE),))


class ExplicitGapAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        after_gap = replace(
            canonical_batch(2), data_quality=(DataQualityFlag.GAP_BEFORE,)
        )
        return iter((canonical_batch(0), after_gap))


class FalseGapAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        contiguous = replace(
            canonical_batch(1), data_quality=(DataQualityFlag.GAP_BEFORE,)
        )
        return iter((canonical_batch(0), contiguous))


def _measured_bits(width: int = 1) -> QualifiedPackedBits:
    return QualifiedPackedBits(
        PackedBits(width, bytes((width + 7) // 8)), ValueStatus.MEASURED
    )


def _process_is_running(process_id: int) -> bool:
    result = subprocess.run(
        ["ps", "-o", "stat=", "-p", str(process_id)],
        capture_output=True,
        check=False,
        text=True,
    )
    status = result.stdout.strip()
    return result.returncode == 0 and bool(status) and not status.startswith("Z")


class OptionalWidthChangingAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        first = replace(canonical_batch(0), measurements=_measured_bits(1))
        second = replace(canonical_batch(1), measurements=_measured_bits(9))
        return iter((first, second))


class OptionalPresenceChangingAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        fields = {
            name: _measured_bits()
            for name in (
                "measurements",
                "observables",
                "erasures",
                "leakage",
                "heralds",
            )
        }
        return iter((canonical_batch(0), replace(canonical_batch(1), **fields)))


class TimestampProfileChangingAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        timestamps = QualifiedTimestamps(
            TimestampSeries((1.0,), "ns"), ValueStatus.MEASURED
        )
        return iter(
            (
                canonical_batch(0),
                replace(canonical_batch(1), source_timestamps=timestamps),
            )
        )


class RoundProfileChangingAdapter(GoodAdapter):
    def import_batches(self, source: Path, mapping: ImportMapping):
        rounds = QualifiedRange(IndexRange(1, 2), ValueStatus.MEASURED)
        return iter(
            (canonical_batch(0), replace(canonical_batch(1), round_range=rounds))
        )


@pytest.mark.skipif(os.name != "posix", reason="POSIX process-group integration")
def test_successful_worker_kills_delayed_descendants(source: Path) -> None:
    original = source.read_bytes()
    report = run_trusted_contract(DelayedDescendantAdapter, source)
    descendant_ids = tuple(
        int(value) for value in source.with_suffix(".descendants").read_text().split()
    )
    assert not any(_process_is_running(process_id) for process_id in descendant_ids)
    time.sleep(0.9)
    assert report.passed
    assert source.read_bytes() == original


@pytest.mark.skipif(os.name != "posix", reason="detached descendant regression")
def test_secure_default_never_runs_without_enforced_containment(source: Path) -> None:
    original = source.read_bytes()
    report = run_adapter_contract(DetachedDescendantAdapter, source)
    time.sleep(0.9)
    assert report.failure_codes == ("isolation_unavailable",)
    assert source.read_bytes() == original


def test_isolation_backend_boundary_is_explicit() -> None:
    assert compliance.detect_secure_isolation_backend(os.name) is None
    backend = compliance.trusted_process_group_backend()
    assert backend.name == "trusted_posix_process_group"
    assert not backend.os_enforced


def test_detected_backend_must_attest_os_enforcement(
    source: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    detected = Mock(name="detected_backend")
    detected.name = "misclassified_process_group"
    detected.os_enforced = False
    detected.context.return_value = None
    monkeypatch.setattr(
        isolation, "detect_secure_isolation_backend", lambda _platform: detected
    )

    report = run_adapter_contract(GoodAdapter, source)

    assert report.failure_codes == ("isolation_unavailable",)
    assert report.failures[0].message == "detected backend is not OS-enforced"
    detected.context.assert_not_called()


def test_secure_detection_fails_closed_on_unsupported_platforms() -> None:
    assert compliance.detect_secure_isolation_backend("posix") is None
    assert compliance.detect_secure_isolation_backend("nt") is None


@pytest.mark.skipif(os.name != "nt", reason="Windows isolation integration")
def test_windows_fails_closed_without_tree_isolation(source: Path) -> None:
    report = run_adapter_contract(GoodAdapter, source)
    assert report.failure_codes == ("isolation_unavailable",)


@pytest.mark.parametrize(
    ("factory", "code"),
    [
        (ValidationMappingMismatchAdapter, "validation_mapping_provenance_mismatch"),
        (PreviewMappingMismatchAdapter, "preview_mapping_provenance_mismatch"),
        (ImportMappingMismatchAdapter, "batch_mapping_provenance_mismatch"),
    ],
)
def test_expected_mapping_provenance_is_enforced(
    source: Path, factory, code: str
) -> None:
    assert code in run_trusted_contract(factory, source).failure_codes


def test_explicit_gap_quality_allows_sequence_discontinuity(source: Path) -> None:
    assert run_trusted_contract(ExplicitGapAdapter, source).passed


def test_gap_quality_is_rejected_without_a_discontinuity(source: Path) -> None:
    report = run_trusted_contract(FalseGapAdapter, source)
    assert "batch_sequence_false_gap" in report.failure_codes


@pytest.mark.parametrize(
    "factory",
    [
        OptionalWidthChangingAdapter,
        OptionalPresenceChangingAdapter,
        TimestampProfileChangingAdapter,
        RoundProfileChangingAdapter,
    ],
)
def test_same_segment_schema_profile_cannot_change(source: Path, factory) -> None:
    report = run_trusted_contract(factory, source)
    assert "batch_schema_profile_changed" in report.failure_codes
