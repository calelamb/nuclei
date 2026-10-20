# R-E report: test hygiene (R-21), Wave 0a

Branch prd15/r-e, commit e91c189 (base b9e3378). Worktree .worktrees/prd15-u/r-e.

## What was implemented

1. **importorskip in the 11 optional-dep modules** (`kernel/tests/qec_data/test_{catalog,engine_import_mapping,queries,server,server_review,storage,storage_durability,storage_record_kinds,tabular_adapter}.py`: duckdb + pyarrow; `test_qec_data_schemas.py`: jsonschema; `test_qec_import_chunk_schemas.py`: jsonschema + referencing). Each is placed before the first third-party import.
2. **test_docs_fixtures.py**: the skip helper now derives requirements from adapter routing (detect regex, `language` hint, source-mode and `STIM_SOURCE_SPEC` specs) plus a `MESSAGE_REQUIRES` table (environment, discovery_evaluators, qec_generate, qec_snapshot, qec_decode_sample, qec_campaign_start, qec_estimate). Docstring updated: Q# fixtures are now skipped without qdk (previously "hard requirement").
3. **conftest.py**: `OPTIONAL_DEPENDENCY_GUARDS` + `pytest_collection_modifyitems` skip the qdk-dependent tests in `test_qsharp_adapter.py`, `test_adapter_bloch_order.py` and the `test_qsharp_*` tests of `test_experiment_execution.py` (files I do not own, so guarded centrally). New `test_optional_dependency_guards.py` keeps the table honest.
4. **tests/e2e/support/qecDataEngine.ts** + new `pythonInterpreter.ts`: `NUCLEI_E2E_PYTHON` (trusted) > repo `.venv` > system python (CI path), each probed for `websockets, duckdb, pyarrow, jsonschema, stim`; if none is capable the test is skipped via `test.skip(true, reason)` with an explicit reason. Unit test `pythonInterpreter.node-test.ts` (`node --test`, named so Playwright's `*.test.ts` glob does not pick it up; vitest only includes `src/**`).
5. **Cargo isolation**: root cause found by bisecting the 210 lib tests under a fake HOME: `commands::kernel::tests::token_is_withheld_until_ready_and_while_the_child_is_dead` builds a `KernelState`; its `Drop` -> `stop()` -> `ownership::runtime_dir()` -> `remove_owner_record` deleted `~/.nuclei/runtime/kernel-owner.json` (kernel.json untouched, matching the audit). Not `kernel_legacy::tests::live` (those never touch the runtime dir). Fix in `kernel_ownership.rs`: `runtime_dir()` returns `None` under `cfg!(test)` unless `NUCLEI_RUNTIME_DIR` is set; it never falls back to HOME in unit tests. Guard test `kernel_unit_tests_never_touch_the_runtime_dir_under_home` re-runs `commands::kernel*` tests in a child process with HOME = fake home holding a kernel-owner.json + kernel.json (NUCLEI_RUNTIME_DIR removed) and asserts the directory is byte-identical.

## TDD evidence

RED, kernel (before changes, minimal venv `pytest kernel/tests -q --co`):
`2106 tests collected, 11 errors` (`ModuleNotFoundError: duckdb|pyarrow|jsonschema` for the 11 modules). Full run before the docs/conftest changes (after importorskip): `35 failed, 2043 passed, 56 skipped` (10 test_docs_fixtures, 19 test_qsharp_adapter, 5 test_experiment_execution, 1 test_adapter_bloch_order; causes: stim/qdk absent).

GREEN, kernel: see suite results below (0 failed).

RED, node resolver: `node --test tests/e2e/support/pythonInterpreter.test.ts` -> `fail 1` (module `./pythonInterpreter.ts` did not exist). GREEN after implementing: `tests 4, pass 4, fail 0`.

RED, cargo: guard test before the `runtime_dir` fix:
```
assertion `left == right` failed: kernel unit tests modified the runtime dir under HOME
  left: {"kernel.json": [...]}
 right: {"kernel-owner.json": [...], "kernel.json": [...]}
test result: FAILED. 0 passed; 1 failed
```
GREEN: `cargo test` -> lib `211 passed; 0 failed; 1 ignored`, `tests/qec_data_lifecycle.rs` `13 passed`.

E2E: `npx playwright test tests/e2e/qec-import.spec.ts --project=chromium` -> 1 passed with the repo .venv (before: system python3 -> "No module named 'websockets'"). With `.venv` temporarily removed: `1 skipped`.

## Full-suite results

- **Minimal venv** (uv, python 3.12.14, only kernel/requirements.txt + pytest + pytest-asyncio; qdk, stim, sinter, pymatching, pyarrow, duckdb, jsonschema all absent), `pytest kernel/tests -q`:
  `2031 passed, 106 skipped, 306 warnings in 276.91s` (0 failed, 0 errors).
- **Dev .venv** run 1: `4 failed, 2704 passed, 13 skipped in 514s`. The 4 failures are `test_agent_worker.py` (returncode -9, worker SIGKILLed under load while other units ran builds in parallel); `pytest kernel/tests/test_agent_worker.py` alone: `13 passed`. Unrelated to this unit. Run 2: see the addendum at the bottom.
- Cargo: `cargo test` all green (above). `~/.nuclei/runtime` not touched at any point (all experiments used a fake HOME under the scratchpad).
- eslint `tests/e2e/support`: clean.

## Files changed

kernel/tests/conftest.py; kernel/tests/test_docs_fixtures.py; kernel/tests/test_qec_data_schemas.py; kernel/tests/test_qec_import_chunk_schemas.py; kernel/tests/qec_data/test_{catalog,engine_import_mapping,queries,server,server_review,storage,storage_durability,storage_record_kinds,tabular_adapter}.py; kernel/tests/test_optional_dependency_guards.py (new); src-tauri/src/commands/kernel_ownership.rs; tests/e2e/support/qecDataEngine.ts; tests/e2e/support/pythonInterpreter.ts (new); tests/e2e/support/pythonInterpreter.node-test.ts (new).

## Decisions

- Decision: cargo isolation is done by making `runtime_dir()` return `None` in `cfg!(test)` builds (unless `NUCLEI_RUNTIME_DIR` is set) rather than setting the env var per test. The culprit test lives in `commands/kernel.rs`, which I do not own, and an env var is process-global/racy across parallel tests; the fix in the owned file covers every test. `kernel_legacy` tests needed no change (they never touch the runtime dir).
- Decision: the "untouched" assertion is a child-process re-run under a fake HOME (an in-process check of the real `~/.nuclei/runtime` would be racy and would itself touch the owner's directory).
- Decision: the minimal venv has no qdk (it is not in kernel/requirements.txt), so Q# tests/fixtures also skip; the three non-owned Q# test files are guarded centrally in conftest instead of edited.
- Decision: the e2e interpreter order is env > repo `.venv` > system python, all probed, so the existing `qec-frontend.yml` job (system python with deps) keeps running the spec rather than skipping.
- Decision: the node test file is `*.node-test.ts` to avoid Playwright's default `*.test.ts` testMatch.

## For R-D (minimal-venv job)

- Command: `pytest kernel/tests -v` (whole suite) in `pytest-minimal-venv`.
- The "assert optional packages absent" step should also list `qdk` (it is now relied upon being absent-or-skipped; harmless either way).
- The node resolver test is not wired into CI (.github not owned): `node --test tests/e2e/support/pythonInterpreter.node-test.ts` (Node >= 22.18).

## For R-F

No importorskip needed in `test_discovery_isolation.py`, `test_discovery_prescreen.py` or `test_trainability_convert_composite.py`: they already skip/pass on the minimal venv (see the run above).

## Self-review

- Completeness: all four brief items done; the extra qdk skips were required to make the whole suite green on a minimal venv.
- Concern: the importorskip lines sit between imports (E402 if ruff ever linted tests; it does not).
- Concern: `test.skip` is called inside `launchRealQecDataEngine`, so it must keep being called from inside a test body (it is).
- The guard test spawns the test binary itself (~5 s extra on `cargo test`).

## Addendum: dev .venv run 2

`pytest kernel/tests -q` on the dev .venv, re-run on the committed tree: `2708 passed, 13 skipped, 697 warnings in 567.67s`, 0 failed. The run-1 test_agent_worker failures did not recur (load-dependent SIGKILL).

## Fix report (review r1)

Finding (Important): `kernel/tests/conftest.py` skipped whole modules `test_qsharp_adapter.py` (28 tests) and `test_adapter_bloch_order.py` (3 tests) when `qdk` was absent, hiding ~11 tests that pass on the minimal venv.

Changes:
* `OptionalDependencyGuard` gained `test_names` and a `selects()` method (exact function name via `item.originalname`, so parametrized cases match; `name_prefix` still supported, and an empty prefix no longer matches everything).
* Guards now list explicitly the 19 `test_qsharp_adapter.py` tests and the 1 `test_adapter_bloch_order.py` test that fail on a venv without qdk. The set was found empirically: guards removed, both modules run on a minimal uv venv (requirements.txt + pytest + pytest-asyncio) gave exactly `20 failed, 15 passed` (the 20 are the guarded names).
* `test_optional_dependency_guards.py`: new `test_every_guard_selects_tests_that_exist` (AST-checks that every named test, and any prefix, exists in its module, and that a guard cannot be module-wide) and `test_qdk_free_tests_are_not_guarded` (detect-pattern, plain-Python routing and the two Qiskit-only Bloch-order tests must stay unguarded).

Verification:
* Minimal venv: `pytest kernel/tests/test_qsharp_adapter.py kernel/tests/test_adapter_bloch_order.py kernel/tests/test_optional_dependency_guards.py kernel/tests/test_experiment_execution.py -q -rs` -> `30 passed, 25 skipped` (skips: 19 + 1 + 5, all qdk). Previously the two modules skipped 31 tests; 11 now run and pass.
* Dev .venv, same command -> `55 passed`.
* Whole-suite minimal-venv run not repeated: the change only alters which tests in those modules skip.
