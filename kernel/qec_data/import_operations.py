"""Bounded adapter result formatting and import precondition checks."""

from __future__ import annotations

from typing import Any

from .adapters.base import ImportChunk
from .protocol import ProtocolError


def batch_summary(batch: Any) -> dict[str, object]:
    payload = batch.payload if type(batch) is ImportChunk else batch
    return {
        "recordKind": payload.record_kind,
        "recordCount": payload.record_count,
        "sequenceStart": payload.sequence_start,
        "sequenceEnd": payload.sequence_end,
        "segmentId": payload.segment_id,
    }


def probe_result(registration: Any, result: Any) -> dict[str, object]:
    return {
        "adapterId": registration.manifest.id,
        "adapterVersion": registration.manifest.version,
        "supported": result.supported,
        "sourceKind": result.source_kind,
        "confidence": result.confidence,
        "sourceSha256": result.source_sha256,
        "details": dict(result.details),
    }


def validation_issue(issue: Any) -> dict[str, object]:
    return {
        "code": issue.code,
        "message": issue.message,
        "severity": issue.severity.value,
        "field": issue.field,
    }


def require_valid_preview(validation: Any, request_id: str) -> None:
    if not validation.valid:
        raise ProtocolError(
            "import_validation_failed",
            "Import mapping must validate before preview.",
            request_id,
        )


def require_copied_hash(validation: Any, copied_hash: str) -> None:
    if not validation.valid or validation.source_sha256 is None:
        raise ProtocolError("import_validation_failed", "Import source is invalid.")
    if validation.source_sha256 != copied_hash:
        raise ProtocolError(
            "source_changed", "Import source changed while it was being copied."
        )
