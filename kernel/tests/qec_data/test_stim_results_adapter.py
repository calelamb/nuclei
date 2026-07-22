from __future__ import annotations

from pathlib import Path

import pytest

from kernel.qec_data.adapters.base import (
    ImportChunk,
    ImportMapping,
    SourceSpan,
    SourceSpanPrecision,
)
from kernel.qec_data.adapters.stim_results import (
    StimMeasurementTargetsUnsupported,
    StimResultsAdapter,
)
from kernel.qec_data.model_validation import ValueStatus
from kernel.qec_data.models import IndexRange, SyndromeBatch
from kernel.tests.qec_data.adapter_contract import (
    run_adapter_contract,
    trusted_process_group_backend,
)


ROWS = tuple(
    (0, 2) if index % 3 == 0 else () if index % 3 == 1 else (1,) for index in range(64)
)


def _mapping(
    *, expected_provenance_id: str = "stim-provenance", **options: object
) -> ImportMapping:
    values = {
        "detector_count": 3,
        "observable_count": 0,
        "session_id": "stim-session",
        "segment_id": "stim-segment",
        **options,
    }
    return ImportMapping(
        options=tuple(sorted(values.items())),
        expected_provenance_id=expected_provenance_id,
    )


def _pack_rows(rows: tuple[tuple[int, ...], ...]) -> bytes:
    return bytes(sum(1 << bit for bit in row) for row in rows)


def _r8(rows: tuple[tuple[int, ...], ...], width: int) -> bytes:
    output = bytearray()
    for row in rows:
        gap = 0
        for bit in tuple(index in row for index in range(width)) + (True,):
            if bit:
                output.append(gap)
                gap = 0
            else:
                gap += 1
    return bytes(output)


def _ptb64(rows: tuple[tuple[int, ...], ...], width: int) -> bytes:
    output = bytearray()
    for bit_index in range(width):
        word = sum(
            (1 << shot_index) for shot_index, row in enumerate(rows) if bit_index in row
        )
        output.extend(word.to_bytes(8, "little"))
    return bytes(output)


@pytest.fixture
def stim_fixture_set(tmp_path: Path) -> dict[str, Path]:
    paths = {
        extension: tmp_path / f"shots.{extension}"
        for extension in ("01", "b8", "r8", "ptb64", "hits", "dets")
    }
    paths["01"].write_text(
        "".join(
            "".join("1" if bit in row else "0" for bit in range(3)) + "\n"
            for row in ROWS
        ),
        encoding="ascii",
    )
    paths["b8"].write_bytes(_pack_rows(ROWS))
    paths["r8"].write_bytes(_r8(ROWS, 3))
    paths["ptb64"].write_bytes(_ptb64(ROWS, 3))
    paths["hits"].write_text(
        "".join(",".join(map(str, row)) + "\n" for row in ROWS), encoding="ascii"
    )
    paths["dets"].write_text(
        "".join("shot" + "".join(f" D{bit}" for bit in row) + "\n" for row in ROWS),
        encoding="ascii",
    )
    return paths


def _decode_rows(
    path: Path, mapping: ImportMapping | None = None
) -> tuple[tuple[int, ...], ...]:
    if mapping is None:
        mapping = (
            _mapping(shot_count=len(ROWS)) if path.suffix == ".hits" else _mapping()
        )
    chunks = tuple(StimResultsAdapter().import_batches(path, mapping))
    decoded: list[tuple[int, ...]] = []
    for chunk in chunks:
        assert isinstance(chunk, ImportChunk)
        assert isinstance(chunk.payload, SyndromeBatch)
        batch = chunk.payload
        width = batch.detector_events.bit_width
        stride = batch.detector_events.bytes_per_record
        for offset in range(0, len(batch.detector_events.data), stride):
            packed = int.from_bytes(
                batch.detector_events.data[offset : offset + stride], "little"
            )
            decoded.append(
                tuple(index for index in range(width) if packed & (1 << index))
            )
    return tuple(decoded)


@pytest.mark.parametrize("extension", ["01", "b8", "r8", "ptb64", "hits", "dets"])
def test_stim_formats_normalize_to_same_detection_events(
    extension: str, stim_fixture_set: dict[str, Path]
) -> None:
    assert _decode_rows(stim_fixture_set[extension]) == ROWS


def test_stim_splits_observables_and_caps_batches(tmp_path: Path) -> None:
    source = tmp_path / "large.01"
    source.write_text("1001\n" * 65_537, encoding="ascii")
    chunks = tuple(
        StimResultsAdapter().import_batches(
            source,
            _mapping(detector_count=3, observable_count=1),
        )
    )
    batches = tuple(chunk.payload for chunk in chunks)
    assert tuple(batch.record_count for batch in batches) == (65_536, 1)
    assert batches[0].observables.status is ValueStatus.MEASURED
    assert batches[0].observables.value is not None
    assert batches[0].observables.value.data[:1] == b"\x01"
    assert chunks[0].source_spans == (
        SourceSpan(
            source_id=chunks[0].source_spans[0].source_id,
            row_range=IndexRange(0, 65_536),
            byte_ranges=(IndexRange(0, 65_536 * len("1001\n")),),
            precision=SourceSpanPrecision.EXACT,
        ),
    )
    assert chunks[1].source_spans[0].row_range == IndexRange(65_536, 65_537)


def test_stim_rejects_missing_width_and_malformed_bits(tmp_path: Path) -> None:
    source = tmp_path / "bad.01"
    source.write_text("10x\n", encoding="ascii")
    adapter = StimResultsAdapter()
    missing = adapter.validate(source, ImportMapping())
    malformed = adapter.validate(source, _mapping())
    assert not missing.valid
    assert missing.issues[0].code == "stim_width_required"
    assert not malformed.valid
    assert malformed.issues[0].code == "stim_invalid_data"


def test_stim_preview_is_bounded_and_probe_is_read_only(
    stim_fixture_set: dict[str, Path],
) -> None:
    source = stim_fixture_set["dets"]
    before = source.read_bytes()
    adapter = StimResultsAdapter()
    probe = adapter.probe(source)
    preview = adapter.preview(source, _mapping(), 3)
    assert probe.supported and probe.source_kind == "stim-dets"
    assert sum(chunk.payload.record_count for chunk in preview.batches) == 3
    assert preview.truncated
    assert source.read_bytes() == before


def test_stim_rejects_nonzero_b8_padding(tmp_path: Path) -> None:
    source = tmp_path / "padding.b8"
    source.write_bytes(b"\x85")
    report = StimResultsAdapter().validate(source, _mapping())
    assert not report.valid
    assert "padding" in report.issues[0].message


@pytest.mark.parametrize("limit", [1, 3])
def test_ptb64_partial_preview_uses_container_lineage(
    stim_fixture_set: dict[str, Path], limit: int
) -> None:
    preview = StimResultsAdapter().preview(stim_fixture_set["ptb64"], _mapping(), limit)
    assert preview.batches[0].source_spans[0].precision is SourceSpanPrecision.CONTAINER
    assert preview.batches[0].source_spans[0].row_range is None


@pytest.mark.parametrize(
    ("extension", "contents"),
    [
        ("01", b"101"),
        ("01", b"101\r\n"),
        ("hits", b"0,2"),
        ("dets", b"shot D0 D2"),
    ],
)
def test_stim_text_formats_require_lf_terminated_records(
    tmp_path: Path, extension: str, contents: bytes
) -> None:
    source = tmp_path / f"unterminated.{extension}"
    source.write_bytes(contents)
    mapping = _mapping(shot_count=1) if extension == "hits" else _mapping()
    assert not StimResultsAdapter().validate(source, mapping).valid


def test_sparse_duplicate_and_order_semantics_are_idempotent_sets(
    tmp_path: Path,
) -> None:
    hits = tmp_path / "duplicates.hits"
    hits.write_text("2,0,0\n", encoding="ascii")
    dets = tmp_path / "duplicates.dets"
    dets.write_text("shot D2 D0 D0\n", encoding="ascii")
    assert _decode_rows(hits, _mapping(shot_count=1)) == ((0, 2),)
    assert _decode_rows(dets) == ((0, 2),)


def test_hits_requires_shot_count_to_disambiguate_blank_trailing_lines(
    tmp_path: Path,
) -> None:
    source = tmp_path / "ambiguous.hits"
    source.write_bytes(b"0\n\n\n")
    adapter = StimResultsAdapter()

    missing = adapter.validate(source, _mapping())
    assert not missing.valid
    assert missing.issues[0].code == "stim_shot_count_required"

    assert _decode_rows(source, _mapping(shot_count=2)) == ((0,), ())
    assert _decode_rows(source, _mapping(shot_count=1)) == ((0,),)


def test_hits_rejects_nonblank_data_after_declared_shot_count(tmp_path: Path) -> None:
    source = tmp_path / "extra.hits"
    source.write_bytes(b"0\n\n1\n")
    report = StimResultsAdapter().validate(source, _mapping(shot_count=2))
    assert not report.valid
    assert "after declared shot_count" in report.issues[0].message


def test_dets_measurement_targets_are_valid_but_actionably_unsupported(
    tmp_path: Path,
) -> None:
    source = tmp_path / "measurements.dets"
    source.write_text("shot M0 D1 L0\n", encoding="ascii")
    report = StimResultsAdapter().validate(source, _mapping(observable_count=1))
    assert not report.valid
    assert report.issues[0].code == "stim_measurement_targets_unsupported"
    assert "valid Stim dets syntax" in report.issues[0].message
    assert "D#/L# detector-sampler output" in report.issues[0].message
    with pytest.raises(StimMeasurementTargetsUnsupported):
        tuple(StimResultsAdapter().import_batches(source, _mapping(observable_count=1)))


def test_stim_rejects_unbounded_text_record(tmp_path: Path) -> None:
    source = tmp_path / "huge.hits"
    source.write_bytes(b"0," * 524_289 + b"0\n")
    report = StimResultsAdapter().validate(source, _mapping(shot_count=1))
    assert not report.valid
    assert "1 MiB" in report.issues[0].message


class ContractStimResultsAdapter(StimResultsAdapter):
    @staticmethod
    def _contract_mapping(mapping: ImportMapping) -> ImportMapping:
        return _mapping(expected_provenance_id=mapping.expected_provenance_id)

    def validate(self, source: Path, mapping: ImportMapping):
        return super().validate(source, self._contract_mapping(mapping))

    def preview(self, source: Path, mapping: ImportMapping, limit: int):
        return super().preview(source, self._contract_mapping(mapping), limit)

    def import_batches(self, source: Path, mapping: ImportMapping):
        return super().import_batches(source, self._contract_mapping(mapping))


def test_stim_adapter_passes_typed_contract(stim_fixture_set: dict[str, Path]) -> None:
    report = run_adapter_contract(
        ContractStimResultsAdapter,
        stim_fixture_set["dets"],
        isolation_backend=trusted_process_group_backend(),
    )
    assert report.passed, report.failures
