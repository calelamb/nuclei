from __future__ import annotations

import asyncio
from pathlib import Path

from kernel.qec_data.adapters.base import (
    AdapterCapability,
    AdapterCommand,
    ImportChunk,
    ImportMapping,
    SourceSpan,
    SourceSpanPrecision,
    StreamConfig,
)
from kernel.qec_data.adapters.sinter_csv import SinterCsvAdapter
from kernel.qec_data.models import CampaignPointBatch, IndexRange
from kernel.tests.qec_data.adapter_contract import (
    run_adapter_contract,
    trusted_process_group_backend,
)


HEADER = "shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts\n"


def _mapping() -> ImportMapping:
    return ImportMapping(
        options=(("session_id", "sinter-session"), ("segment_id", "aggregate")),
        expected_provenance_id="sinter-provenance",
    )


def test_sinter_preserves_standard_columns_and_json_metadata(tmp_path: Path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text(
        HEADER
        + '100,3,2,1.25,pymatching,strong-a,"{""d"":3,""p"":0.001}","{""timeouts"":1}"\n',
        encoding="utf-8",
    )
    chunks = tuple(SinterCsvAdapter().import_batches(source, _mapping()))
    assert len(chunks) == 1
    assert isinstance(chunks[0], ImportChunk)
    assert isinstance(chunks[0].payload, CampaignPointBatch)
    row = chunks[0].payload.records[0]
    assert row.shots == 100
    assert row.errors == 3
    assert row.json_metadata == '{"d":3,"p":0.001}'
    assert row.custom_counts == '{"timeouts":1}'
    span = chunks[0].source_spans[0]
    assert span == SourceSpan(
        source_id=span.source_id,
        row_range=IndexRange(1, 2),
        byte_ranges=(IndexRange(len(HEADER.encode()), len(source.read_bytes())),),
        precision=SourceSpanPrecision.EXACT,
    )


def test_sinter_rejects_duplicate_json_keys_and_negative_counts(tmp_path: Path) -> None:
    source = tmp_path / "bad.csv"
    source.write_text(
        HEADER + '10,-1,0,1,pymatching,s,"{""d"":3,""d"":5}",{}\n',
        encoding="utf-8",
    )
    report = SinterCsvAdapter().validate(source, _mapping())
    assert not report.valid
    assert report.issues[0].code == "sinter_invalid_data"


def test_sinter_requires_exact_standard_header(tmp_path: Path) -> None:
    source = tmp_path / "bad.csv"
    source.write_text("shots,errors\n10,1\n", encoding="utf-8")
    report = SinterCsvAdapter().validate(source, _mapping())
    assert not report.valid
    assert "required sinter columns" in report.issues[0].message


def test_sinter_multiline_csv_field_keeps_record_not_line_ordinal(
    tmp_path: Path,
) -> None:
    source = tmp_path / "multiline.csv"
    source.write_text(
        HEADER + '100,3,2,1.25,pymatching,strong-a,"{""d"":3,\n""p"":0.001}",{}\n',
        encoding="utf-8",
    )
    chunk = next(SinterCsvAdapter().import_batches(source, _mapping()))
    assert chunk.payload.records[0].json_metadata == '{"d":3,"p":0.001}'
    assert chunk.source_spans[0].row_range == IndexRange(1, 2)
    assert chunk.source_spans[0].byte_ranges == (
        IndexRange(len(HEADER.encode()), len(source.read_bytes())),
    )


def test_sinter_rejects_unbounded_csv_record(tmp_path: Path) -> None:
    source = tmp_path / "huge.csv"
    source.write_bytes(
        HEADER.encode() + b'1,0,0,1,pymatching,strong,"' + b"x" * 1_048_577 + b'",{}\n'
    )
    report = SinterCsvAdapter().validate(source, _mapping())
    assert not report.valid
    assert "safety limit" in report.issues[0].message


def test_sinter_adapter_passes_typed_contract(tmp_path: Path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text(
        HEADER + '100,3,2,1.25,pymatching,strong-a,"{""d"":3}",{}\n',
        encoding="utf-8",
    )
    report = run_adapter_contract(
        SinterCsvAdapter,
        source,
        isolation_backend=trusted_process_group_backend(),
    )
    assert report.passed, report.failures


def test_sinter_probe_preview_and_legacy_optional_counts(tmp_path: Path) -> None:
    legacy_header = HEADER.removesuffix("custom_counts\n").removesuffix(",") + "\n"
    source = tmp_path / "legacy.csv"
    source.write_text(
        legacy_header
        + '100,3,2,1.25,pymatching,strong-a,"{""d"":3}"\n'
        + '200,4,0,2,pymatching,strong-b,"{""d"":5}"\n',
        encoding="utf-8",
    )
    adapter = SinterCsvAdapter()
    assert adapter.probe(source).supported
    preview = adapter.preview(source, _mapping(), 1)
    assert preview.truncated
    assert preview.batches[0].payload.records[0].custom_counts == "{}"

    unsupported = tmp_path / "legacy.txt"
    unsupported.write_bytes(source.read_bytes())
    assert not adapter.probe(unsupported).supported


def test_sinter_live_capabilities_are_explicitly_unsupported() -> None:
    adapter = SinterCsvAdapter()
    stream = asyncio.run(adapter.stream_batches(StreamConfig("sinter-csv")))
    command = asyncio.run(adapter.command(AdapterCommand("noop")))
    assert stream.capability is AdapterCapability.STREAM
    assert command.capability is AdapterCapability.COMMAND


def test_sinter_small_rows_coalesce_into_practical_chunks(tmp_path: Path) -> None:
    source = tmp_path / "many.csv"
    source.write_text(
        HEADER
        + "".join(
            f'100,3,0,1,pymatching,strong-{index},"{{""d"":3}}",{{}}\n'
            for index in range(1_000)
        ),
        encoding="utf-8",
    )
    chunks = tuple(SinterCsvAdapter().import_batches(source, _mapping()))
    assert len(chunks) == 1
    assert chunks[0].record_count == 1_000
