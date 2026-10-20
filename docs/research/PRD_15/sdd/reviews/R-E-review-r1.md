# Review R-E (round 1): test hygiene (R-21)

Base b9e3378, head e91c189 (1 commit). Package: `reviews/R-E-r1.diff` (read once).

## Verdict

- Spec compliance: **yes**. All four brief items are done. There are minor ownership notes about new files and one deviation in mechanism.
- Quality: **Needs fixes**. There is 1 Important finding: the central qdk skip guards are over-broad and hide tests that pass on the minimal venv.

## Spec compliance, file by file (owned list in the brief)

| Owned file | Status |
|---|---|
| The 11 optional-dependency modules | Done. `pytest.importorskip` comes before the first third-party import: the 9 `qec_data/test_*.py` files plus the two schema tests (jsonschema, and `referencing` too). |
| `kernel/tests/test_docs_fixtures.py` | Done. Requirements now come from adapter routing (the source-mode language hint, `STIM_SOURCE_SPEC`) plus `MESSAGE_REQUIRES`. This covers the 6 stim fixtures the audit named, and the Q# fixtures as well. |
| `kernel/tests/conftest.py` | Done. A guard table for 3 qdk-dependent modules R-E may not edit. |
| `tests/e2e/support/qecDataEngine.ts` | Done. Resolution order is `NUCLEI_E2E_PYTHON` > repo `.venv` > system python. Each candidate except the explicit one is probed, and the test is skipped with an explicit reason when none works. |
| `src-tauri/src/commands/kernel_ownership.rs` (tests) | Done. A regression test re-runs the `commands::kernel*` tests in a child process under a fake HOME and asserts the runtime directory is byte-identical afterwards. The RED evidence matches the audit (`kernel-owner.json` deleted). |
| `src-tauri/src/commands/kernel_legacy.rs` (tests) | **Not touched.** It is listed in the brief, but the report locates the root cause elsewhere (`KernelState::drop` → `stop()` → `remove_owner_record`). The guard test also runs the `kernel_legacy` tests under a fake HOME (filter `commands::kernel` matches them), so this file is covered without changes. Acceptable. |

Deviations and extras:

- Mechanism: the brief says the cargo tests should "set `NUCLEI_RUNTIME_DIR` to a tempdir". Instead, `runtime_dir()` returns `None` under `cfg!(test)` (`kernel_ownership.rs:43`), which changes non-test code in an owned file. The rationale holds: the env var is process-global and the culprit test is in non-owned `kernel.rs`. The acceptance criterion ("cargo test leaves ~/.nuclei/runtime untouched, test asserts") is met. One side effect: the HOME fallback branch of `runtime_dir()` can no longer be exercised by any unit test.
- Files outside the owned list (Minor, no collision found): `tests/e2e/support/pythonInterpreter.ts`, `tests/e2e/support/pythonInterpreter.node-test.ts`, `kernel/tests/test_optional_dependency_guards.py`.
- `.github` was correctly not edited; the minimal-job command was handed to R-D, and R-D's workflow runs the whole suite and also asserts `qdk` is absent.

## Important

1. **`kernel/tests/conftest.py:40-41`: the module-wide qdk guards skip tests that do not need qdk, so the minimal-venv job loses coverage it had.**
   - `OptionalDependencyGuard("test_qsharp_adapter.py", ("qdk",))` and `("test_adapter_bloch_order.py", ("qdk",))` skip every test in those modules when qdk is absent. By the report's own RED numbers, only 19 of the 28 tests in `test_qsharp_adapter.py` and 1 of the 3 in `test_adapter_bloch_order.py` failed without qdk.
   - The rest now skip silently on the minimal venv. These are exactly the stock-venv paths principle 5 says must work: `test_qsharp_detect_pattern_ignores_python_starter_templates`, `test_executor_language_python_skips_qsharp_adapter`, `test_plain_python_still_unsupported_framework`, the telemetry opt-out tests, and the two Qiskit-only tests `test_qiskit_bloch_coords_follow_display_qubit_order` and `test_qiskit_bloch_x_axis_lands_on_the_hadamard_qubit`.
   - The unit's goal was to stop the minimal job hiding things, and this guard hides about 11 tests that currently pass.
   - Fix: guard by explicit test names, or by a name set or predicate per module (for example, a `names: frozenset[str]` field next to `name_prefix`), listing only the tests that touch qdk. Extend `test_optional_dependency_guards.py` to assert that every guarded name exists in its module, so the list cannot rot.

## Minor

1. **`tests/e2e/support/pythonInterpreter.node-test.ts` is not run by any npm script or CI job.** Vitest only includes `src/**`, Playwright's glob misses `*.node-test.ts`, and `.github` belongs to R-D, which did not wire it. As things stand this is a test that never runs. Hand a `node --test` step to the workflow owner, or add an npm script.
2. **`tests/e2e/support/qecDataEngine.ts:77`: in CI, an engine environment that breaks now skips instead of failing.** `qec-frontend.yml` installs the dependencies into the system python. If one of them stops importing (a pin breaks, say), the `@qec` import spec silently skips, where before it failed loudly. Suggested fix: honour something like `NUCLEI_E2E_REQUIRE_ENGINE=1` (set in CI) to turn the skip into a failure.
3. **`kernel/tests/test_docs_fixtures.py:244-258`: Q# fixtures, previously documented as a hard requirement in CI, now skip when qdk is missing in the full job too.** No guard asserts zero optional-dependency skips in the full environment. Consider a `NUCLEI_REQUIRE_OPTIONAL=1` env in the full `pytest` job that makes these importorskips fail.
4. **`test_docs_fixtures.py:258`: the docstring "derived from routing, not a hand list" is half true.** `MESSAGE_REQUIRES` is a hand list. Reword it.
5. **`kernel/tests/test_optional_dependency_guards.py:37`: the guard is a substring grep for `pytest.importorskip(`.** It does not prove the skip comes before the third-party imports, which is the property that matters. A stronger check: parse the module AST and assert the importorskip call comes before any `import duckdb/pyarrow/jsonschema`. Alternatively, rely on the minimal CI job alone.
6. **`pythonInterpreter.node-test.ts`: the temp dirs are removed outside `finally`,** so they leak when an assertion fails. The fake interpreters are `#!/bin/sh` scripts, so the test is POSIX-only. Document that.
7. **Report: R-E says R-F's three files need no importorskip because they "already skip/pass on the minimal venv".** That is consistent with the green minimal run, but I did not verify it independently.

## Cannot verify

- The minimal-venv run (`2031 passed, 106 skipped`) and the dev `.venv` run (`2708 passed, 13 skipped`); not re-run.
- That `cargo test` is green, and the RED output of the guard test; not re-run.
- Playwright: 1 passed with `.venv` and 1 skipped without it; not re-run.
