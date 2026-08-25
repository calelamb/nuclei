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
- Added an E2E-only process harness that starts the real authenticated Python QEC Data Engine against a temporary copy of the fixture project. Only Tauri's `qec_data_start` invoke is substituted; the browser's native WebSocket performs real authentication, probe, validation, preview, import, and reload-time `session_list`.
- Added deterministic Stim `.dets` and PyArrow 18 Parquet adapter fixtures. The browser Study advertises only files available through its string fixture bridge.
- Added researcher documentation for formats, stages, status qualification, packed-bit order, provenance, source spans, copy-only policy, quarantine, crash recovery, and the canonical schema layout.
- Added a spawned-process 10-million-record acceptance gate that generates a real packed Stim `.b8` source, resolves `stim-results` v1 from `core_offline_registry`, and streams `adapter.import_batches` through the actual import consumer and Parquet storage/journal commit path.
- Added a weekly/manual Ubuntu and Windows CI workflow for the slow memory gate. Windows records `PeakWorkingSetSize`; POSIX records normalized `ru_maxrss`.

## Acceptance evidence

All JavaScript commands below used the bundled Node 24 runtime because the shell's Node 25/jsdom combination is not an authoritative project runtime.

- Final full frontend suite under Node 24: 145 files, 1,207 tests passed.
- Adapter-aware mapping RED/GREEN suite: 25 tests passed after the two new native-adapter assertions first failed against the generic tabular UI.
- App production build: passed (`tsc -b && vite build`). Existing chunk/dynamic-import warnings only.
- ESLint: passed with 0 errors; four pre-existing generated WASM declaration warnings.
- Docs build: 43 pages built; all internal links valid. Existing Q# syntax-highlighting warnings only.
- Final kernel Stim/server/storage coverage: 100 passed, 1 opt-in memory test skipped; existing dependency deprecation warnings only.
- Memory acceptance command:

  ```bash
  NUCLEI_RUN_MEMORY_ACCEPTANCE=1 python3 -m pytest kernel/tests/qec_data/test_import_memory_acceptance.py -q -s
  ```

  Corrective result: 4 passed in 168.53 seconds. The isolated worker parsed and committed exactly 10,000,000 real Stim records across 153 partitions in 168.435 seconds with peak RSS 264,241,152 bytes (about 252 MiB), below the 512 MiB ceiling. The subprocess timeout is 300 seconds and the asserted worker ceiling is 285 seconds for CI headroom. The gate remains opt-in for normal suites but is enforced by the dedicated scheduled/manual workflow.
- Final Playwright real-engine import gate: 1 passed in 9.3 seconds (8.4-second flow). It used native browser WebSocket transport and proved a complete session manifest, journal generation 1, one committed two-row Parquet partition, no pending partition, process reap, and reload restoration from the live engine. The broader prior workbench run passed 7 scenarios with 2 intentional viewport skips; one existing screenshot wait timed out while Matplotlib built its font cache and passed immediately on isolated rerun.
- `cargo fmt --check`: passed. Strict repository-wide Clippy remains blocked by the pre-existing `KernelState::new` `new_without_default` warning in `src-tauri/src/commands/kernel.rs`, outside this task's Rust-free scope.
- `git diff --check`: passed.

Windows process containment and capability behavior is covered by Task 8. A native Windows runner is still required for final platform CI; this task does not alter the Tauri or Windows backend files.

## Fixture verification

- `minimal.dets`: 22 bytes, SHA-256 `6f45baf5e9f4215ebabc0e5177c34abe7e2fd5489d2531e70a098924d824dfbc`.
- `minimal.parquet`: generated with PyArrow 18.0.0, Parquet 2.6, two rows, one row group, no compression. It contains non-null sequence, packed detector and observable bytes, source timestamps, and explicit detector/observable counts plus `lsb0` metadata.

## Independent review

The first read-only subagent review found no critical issues. Before final verification this task corrected its scientific-truthfulness findings (native Stim mapping, fixture hash/size and preview kind), removed the unavailable browser Parquet reference, aligned Unicode ordering and bounded pagination, replaced incomplete ARIA tree semantics with a native list, and narrowed two documentation claims.

A subsequent acceptance review found that the original browser harness still simulated engine behavior and the first 10M test emitted already-bounded chunks. Both blockers are now removed: Playwright owns a real engine subprocess and disk-backed project copy, and the memory test traverses the registered Stim adapter from source bytes. Native Stim and sinter mapping controls were also narrowed to the options those adapters actually accept.

The final native-adapter review is also closed. Stim and sinter now reject every
field or option they do not consume, and invalid mappings receive no provenance
identity. Standalone Stim requires both widths, with explicit `0` preserving the
scientific distinction between no observables and omitted metadata. Stim `.dets`
keeps `D#` and `L#` namespaces separate through bounds validation, so `D3` can no
longer alias `L0`. Packed `.b8` and `.ptb64` paths transpose/split packed bytes
without expanding all set bits into Python integer sets; the adversarial 1 MiB
all-ones `.b8` record passes validation and import. Adapter coverage is 86% (45
tests), and the corrected 10-million-record gate committed 10,000,000 rows in
153 partitions in 152.45 seconds at 267,370,496 bytes peak RSS.

The authenticated engine also rejects `circuit_path` and `dem_path` before any
adapter method can inspect or open them. Secondary context files are not yet
represented by retained project capabilities, so engine validate, preview, and
start operations require explicit detector and observable widths. Standalone
trusted adapter calls retain context support. A 12-case path/operation matrix,
two missing-width cases, and one explicit-width success case cover this boundary;
the final focused server/native-adapter run passed 93 tests.

The remaining review suggestion is a larger lifecycle enhancement: expose a persistent retry/reconnect control when the engine disconnects after a successful catalog load. Current import launch failures and catalog request failures are surfaced, and stale async catalog writes are rejected; reconnect orchestration should be handled as a dedicated engine lifecycle follow-up rather than hidden inside this acceptance task.

## Scope integrity

Only Task 10 UI, fixtures, docs, the session client/store, and the memory acceptance test are included. Task 8 adapter, server-review, Tauri capability, and Windows process files were not modified or staged by this task.
