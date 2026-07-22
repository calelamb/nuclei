# P2 Task 7 independent-review fix report

## Scope

Closed the six correctness and resource-bound findings from the independent
review of `c85a02d`:

- Stim `hits` duplicates now use documented set-membership semantics instead
  of parity toggling.
- `hits` requires an explicit nonnegative `shot_count`, so blank shots and
  trailing blank padding are never guessed. Data after the declared count and
  files ending before it are rejected.
- Every `ptb64` row carries container-precision lineage, including a one-row
  preview whose bytes necessarily describe a full 64-shot block.
- Valid `dets` `M#` targets raise
  `StimMeasurementTargetsUnsupported` and validate with the distinct
  `stim_measurement_targets_unsupported` code. The error directs users to
  `D#/L#` detector-sampler output; detector and logical targets remain
  supported.
- A tabular `observable_count` without an `observable_events` field mapping is
  rejected during mapping validation with `tabular_mapping_invalid` instead
  of failing later while constructing `PackedBits`.
- Arrow and Parquet sources now have pre-decode container, schema, message,
  batch-count, and selected-column row-group bounds. Column projection avoids
  decoding unused syndrome columns, while calibration imports retain all
  columns because their canonical `original_representation` must remain
  truthful.

The Stim behavior follows the official
[`result_formats.md`](https://github.com/quantumlib/Stim/blob/main/doc/result_formats.md):
`hits` terms set positions to true, blank-line interpretation needs external
shot-count context, `dets` explicitly permits `M`, `D`, and `L` targets, and a
`ptb64` word spans 64 shots.

## TDD evidence

### RED

The focused regressions were added before production changes.

```text
/tmp/nuclei-qec-task7-venv/bin/python -m pytest \
  kernel/tests/qec_data/test_stim_results_adapter.py \
  kernel/tests/qec_data/test_tabular_adapter.py -q
```

Result: `9 failed, 31 passed`.

The failures independently demonstrated XOR duplicate handling, missing
`shot_count`, acceptance of data beyond that count, exact lineage for a
one-shot `ptb64` preview, generic rejection of valid `M#` syntax, late
observable construction failure, and the absence of IPC container/footer and
Parquet metadata bounds.

A second provenance-preservation regression added an unmapped `operator`
column to a Parquet calibration record. It failed because selected-column
projection omitted that column from `original_representation`.

### GREEN

After the minimal fixes, the first focused command passed: `40 passed`.
After preserving full calibration rows and rerunning all three Task 7 adapter
files, the result was `49 passed`.

## PyArrow pre-decode boundary

| Format | Enforced before record materialization | Remaining library limit |
|---|---|---|
| IPC file | Encoded file size before `memory_map`; schema field count; mapped-field existence; footer record-batch count; selected-field projection via `IpcReadOptions` | PyArrow 18 does not expose individual file record-batch body sizes through `RecordBatchFileReader` before `get_batch`; decoded `nbytes` is therefore capped immediately after decode |
| IPC stream | Encoded file size; raw `MessageReader` message body+metadata size; record-batch count; schema field count; selected-field projection | Compression expansion is only knowable after decode; decoded `nbytes` is capped immediately |
| Parquet | Encoded file size; schema field count; row-group count; selected column-chunk uncompressed sizes and aggregate selected row-group bytes from footer metadata; page checksum verification; selected-column projection | PyArrow 18 metadata does not expose individual data-page sizes; selected column-chunk/row-group metadata is the strongest supported pre-page-decode bound |

Decoded Arrow batches are limited to 256 MiB, then recursively subdivided to
the existing 16 MiB normalized chunk limit. Individual canonical rows retain
the 1 MiB limit. The container limits guard parser exposure; they are not
presented as a proof against adversarial compression ratios.

## Verification

- Task 7 focused adapter suite: `49 passed`.
- All adapter tests: `119 passed, 1 skipped`.
- Touched production coverage: total `84%`; `stim_results.py` 83%,
  `tabular.py` 83%, `tabular_sources.py` 85%.
- Ruff format and lint: passed.
- Black 24.10 under Homebrew Python 3.14: 5 files unchanged. The project
  Python 3.12.5 is intentionally refused by Black because of its upstream AST
  memory-safety guard, so the formatting gate used the newer isolated runtime.
- Bandit scoped scan: passed.
- `git diff --check`: passed.
- `compileall`: passed.
- File/function limits: production files are 544, 633, and 403 lines; no
  function exceeds 50 lines.

The first full `kernel/tests/qec_data` run overlapped concurrent Task 6A
changes and reached `331 passed, 2 skipped` with five failures confined to
unstaged Task 6 files (`json_document.py`, its tests, and process-isolation
cleanup). After those fixes landed, the complete committed QEC suite passed:
`339 passed, 2 skipped`. That command explicitly ignored the concurrent,
untracked Task 8 `test_server.py`, which was still in its intentional RED phase
and imported a not-yet-created Task 8 module. No tracked QEC test was excluded.
