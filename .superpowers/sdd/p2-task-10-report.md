# Phase 2 Task 10 — QEC import acceptance, session integration, and documentation

## Outcome

Task 10 closes the canonical QEC import loop through the production frontend contract. Researchers can launch a seven-stage import from a Study source, make scientific meaning explicit, validate before preview or write, observe durable progress, and then select the engine-backed canonical session in Sources / Data. The session catalog is reloaded from the engine after a full app reload; it is not reconstructed from browser persistence.

The implementation supports simulation-facing Stim and sinter sources as well as explicitly mapped hardware syndrome and calibration data. The UI and documentation consistently distinguish per-shot syndrome records from sinter campaign aggregates.

## Delivered

- Added the Source → Adapter → Mapping → Preview → Validation → Destination → Import workflow to the light QEC Workbench acceptance path.
- Added explicit detector/observable widths, record class, timestamp unit, and LSB0 bit order. Native Stim and sinter adapters no longer require invented source-column mappings; tabular adapters still require explicit fields.
- Added strict, correlated `session_list` pagination to `QecDataClient`, including page-size checks, a 10,000-session safety bound, cursor validation, and Python-compatible Unicode code-point ordering.
- Added an immutable, per-project Zustand session catalog with stale-request protection and user-facing load errors.
- Added canonical session rows with kind, lifecycle status, provenance, and linked Research Selection state. The flat collection uses native list semantics and ordinary button keyboard behavior.
- Added an E2E-only authenticated engine boundary that exercises the real client and seven-stage UI. It uses the real `.dets` fixture size/hash, real `syndromes` preview kind, rejects scientifically false mappings, persists only the fake engine's state, and proves reload restoration through `session_list`.
- Added deterministic Stim `.dets` and PyArrow 18 Parquet adapter fixtures. The browser Study advertises only files available through its string fixture bridge.
- Added researcher documentation for formats, stages, status qualification, packed-bit order, provenance, source spans, copy-only policy, quarantine, crash recovery, and the canonical schema layout.
- Added a spawned-process 10-million-record acceptance gate over the actual import consumer and Parquet storage/journal commit path.

## Acceptance evidence

All JavaScript commands below used the bundled Node 24 runtime because the shell's Node 25/jsdom combination is not an authoritative project runtime.

- Full frontend suite before final review hardening: 145 files, 1,201 tests passed.
- Final focused frontend suite: 5 files, 88 tests passed.
- App production build: passed (`tsc -b && vite build`). Existing chunk/dynamic-import warnings only.
- ESLint: passed with 0 errors; four pre-existing generated WASM declaration warnings.
- Docs build: 43 pages built; all internal links valid. Existing Q# syntax-highlighting warnings only.
- Kernel QEC server/storage coverage: 76 passed, 1 opt-in memory test skipped; existing dependency deprecation warnings only.
- Memory acceptance command:

  ```bash
  NUCLEI_RUN_MEMORY_ACCEPTANCE=1 python3 -m pytest kernel/tests/qec_data/test_import_memory_acceptance.py -q -s
  ```

  Result: 2 passed in 137.60 seconds. The isolated worker wrote and committed exactly 10,000,000 records across 153 partitions in 137.507839 seconds with peak RSS 189,923,328 bytes (181.13 MiB), below the 512 MiB ceiling. The measured acceptance timeout and wall-time ceiling are 180 seconds. The gate is opt-in so normal suites do not absorb a two-minute storage benchmark.
- Playwright final integrated run: the new import/reload scenario passed, along with 7 workbench scenarios and 2 intentional viewport skips. One existing screenshot wait timed out while Matplotlib built its font cache; the exact screenshot test passed immediately on isolated rerun (1/1).
- `cargo fmt --check`: passed. Strict repository-wide Clippy remains blocked by the pre-existing `KernelState::new` `new_without_default` warning in `src-tauri/src/commands/kernel.rs`, outside this task's Rust-free scope.
- `git diff --check`: passed.

Windows process containment and capability behavior is covered by Task 8. A native Windows runner is still required for final platform CI; this task does not alter the Tauri or Windows backend files.

## Fixture verification

- `minimal.dets`: 22 bytes, SHA-256 `6f45baf5e9f4215ebabc0e5177c34abe7e2fd5489d2531e70a098924d824dfbc`.
- `minimal.parquet`: generated with PyArrow 18.0.0, Parquet 2.6, two rows, one row group, no compression. It contains non-null sequence, packed detector and observable bytes, source timestamps, and explicit detector/observable counts plus `lsb0` metadata.

## Independent review

The read-only subagent review found no critical issues. Before final verification this task corrected its scientific-truthfulness findings (native Stim mapping, fixture hash/size and preview kind), removed the unavailable browser Parquet reference, aligned Unicode ordering and bounded pagination, replaced incomplete ARIA tree semantics with a native list, and narrowed two documentation claims.

The remaining review suggestion is a larger lifecycle enhancement: expose a persistent retry/reconnect control when the engine disconnects after a successful catalog load. Current import launch failures and catalog request failures are surfaced, and stale async catalog writes are rejected; reconnect orchestration should be handled as a dedicated engine lifecycle follow-up rather than hidden inside this acceptance task.

## Scope integrity

Only Task 10 UI, fixtures, docs, the session client/store, and the memory acceptance test are included. Task 8 adapter, server-review, Tauri capability, and Windows process files were not modified or staged by this task.
