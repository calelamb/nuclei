# Brief — PRD 15 unit R-E

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **R-E Test hygiene (R-21)** (Wave 0a) | `pytest.importorskip` in the 11 optional-dep test modules and the stim-dependent docs fixtures; `pytest-minimal-venv` runs the **whole** `kernel/tests` (command handed to R-D); `tests/e2e/support/qecDataEngine.ts` defaults `NUCLEI_E2E_PYTHON` to the repo `.venv` or skips with a reason; cargo tests set `NUCLEI_RUNTIME_DIR` to a tempdir (never touch `~/.nuclei/runtime`) | the 11 test modules, `kernel/tests/test_docs_fixtures.py`, `kernel/tests/conftest.py`, `tests/e2e/support/qecDataEngine.ts`, `src-tauri/src/commands/kernel_ownership.rs` tests + `src-tauri/src/commands/kernel_legacy.rs` tests | minimal-venv job runs `pytest kernel/tests` green; `cargo test` leaves `~/.nuclei/runtime` untouched (test asserts) |
| **R-E** Test hygiene | importorskip everywhere, minimal-venv whole suite, cargo isolation | §5.1 |

## Binding principles (master §2.1)
### 2.1 Principles (binding)

1. **One mechanism per concern.** One surrogate registry, one noise-model layer, one dataset loader, one declaration reader, one lab message router, one job counter, one real-kernel e2e harness. Specs that each proposed their own were edited (§4.3).
2. **Registries, not shared edits.** Every file that four specs wanted to append to (`_settings.py`, `job_worker.py`, `handlers.py`, `server.py`, `trainability.ts`, `AnalysisTabs.tsx`, `VerdictRail.tsx`, `TargetBar.tsx`, `CommandPalette.tsx`, `useDirac.ts`, `e2eFixtureBridge.ts`) becomes registry-driven in Wave 1 so later units add *their own* file and never touch a shared one. Two units in the same wave never own the same file (§7).
3. **Kernel computes; frontend renders.** No physics in TypeScript beyond view derivation. Every number crossing the socket carries method + interval/reason.
4. **Honest by construction.** `interval` fields are `[lo, hi]`; the TS lint test that greps components for `(lo + hi) / 2` (spec 03 §7.5) applies to every new component.
5. **Stock-venv first.** Every feature has a working path with `kernel/requirements.txt` only (numpy, websockets, ruff, keyring, qiskit, qiskit-aer, cirq-core). Optional packages widen, never gate (§3).
6. **Usable end to end.** Every feature: trigger → running/progress → cancel → result/error/unavailable states, a stub-kernel Playwright spec, and a real-kernel Playwright spec (§5.4, §8).
7. **User code runs in a worker, once per code version.** Every message that executes user code (§5.1 R-B's list) goes through the warm run-worker pool with `project_root` cwd/`sys.path`, RSS and wall limits; parse, inspect, lint, symmetry detection and deploy inspection share one code-hash-keyed loaded-circuit cache, so an edit pause executes the program once, not 3–5 times.
8. **No files over the socket.** Datasets, `.dem` files, shadow snapshot files and candidate programs are never shipped in a frame: the kernel reads them from the validated `project_root` with size caps, and candidates travel as SEARCH/REPLACE edits. The 1 MiB inbound cap closes the socket with 1009 and cancels every Lab job, so `labSession.ts` refuses to send a frame over 1 MiB with a visible error, and an oversized request yields an error envelope, never a disconnect (handler-side validation, `max_size` raised to 4 MiB as the hard backstop).


## Audit items you close (docs/research/PRD_15/00_RELIABILITY_AUDIT.md)

### R-21 (Low-Med) Test-infrastructure gaps that hide the above
- `tests/e2e/qec-import.spec.ts` fails on this box: `Real QEC Data Engine exited before readiness ... No module named 'websockets'`; `support/qecDataEngine.ts:75` defaults to system `python3` unless `NUCLEI_E2E_PYTHON` is set. Default it to the repo `.venv` or skip with an explicit reason.
- On a managed-venv-like env (no pyarrow/duckdb/jsonschema/stim), `pytest kernel/tests` has 11 collection errors (`kernel/tests/qec_data/*`, `test_qec_data_schemas.py`, `test_qec_import_chunk_schemas.py`: `ModuleNotFoundError: duckdb|pyarrow|jsonschema`) and 6 docs-fixture failures (`test_docs_fixtures.py`: `environment`, `qec_generate`, `qec_decode_sample`, `qec_studio`, `lab_discovery_evaluators`, `qec_campaign_start_invalid` assume stim is installed). The `pytest-minimal-venv` CI job hides this by running only `test_discovery_optional_deps.py` + `test_trainability_*.py`.
- `cargo test --lib` appears to touch the real `~/.nuclei/runtime`: after I ran it, `kernel-owner.json` (the shell's ownership record for the owner's running app, which also had pid 2587203) was gone while `kernel.json` was unchanged. I could not confirm which test; `kernel_ownership::runtime_dir()` (`kernel_ownership.rs:31-41`) falls back to `$HOME/.nuclei/runtime` in debug builds when `NUCLEI_RUNTIME_DIR` is unset, and `kernel_legacy::tests::live::*` exercise it. Tests must set `NUCLEI_RUNTIME_DIR` to a tempdir. Side effect on the owner: that app instance can no longer prove it owns its kernel for stale-kernel reaping; restarting the app rewrites it. I tried to restore the 27-byte file and was blocked by the permission guard, so I left it as is.


## Controller rulings for this unit (binding)
- Do NOT edit test files owned by other units this wave: kernel/tests/test_discovery_isolation.py, test_discovery_prescreen.py, test_trainability_convert_composite.py (R-F), kernel/tests/research_corpus/** and test_research_corpus.py (R-D), and .github/** (R-D adds your minimal-job command). If one of R-F`s files needs an importorskip, list it in your report.
- Prove the whole kernel suite is green (or cleanly skipped) on a MINIMAL venv you create yourself with uv (python 3.12, only kernel/requirements.txt + pytest pytest-asyncio) and on the dev .venv; put both outputs in your report.
- cargo tests must use a tempdir NUCLEI_RUNTIME_DIR; add the assertion test that ~/.nuclei/runtime is untouched.
