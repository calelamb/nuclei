# Brief — PRD 15 unit R-D

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **R-D Corpus golden (G0) + wave tooling** (Wave 0a) | promote the 78-program scout corpus to `kernel/tests/research_corpus/scout/` with `expected.yaml` per env (`min`, `qk2`, `full`), driven through the real authenticated WebSocket server by a **glob-based loader** (`research_corpus/loader.py`) that picks up every `research_corpus/<unit>/` directory so later units add programs without editing R-D's files; known failures `xfail(strict=True)` tagged with R-ids; resource gates; `scripts/check-app-env.sh` (G4); **`scripts/make-test-venvs.sh`** (`uv`: 3.12/Qiskit 1.x, 3.13/Qiskit 2.x, minimal, app-env catalog lists); **`scripts/check-wave-ownership.py`** (fails a wave plan if two units in a wave name the same file, or if a spec ownership table names a file the master assigns elsewhere; run on this plan now and in CI); **sole owner of `.github/workflows/kernel-tests.yml` in Wave 0** (R-C's matrix/Qiskit-2 lines and R-E's minimal-job command are handed to R-D) | `kernel/tests/research_corpus/**` (loader + `scout/`), `kernel/tests/test_research_corpus.py`, `kernel/tests/_kernel_client.py` (from `kclient.py`), `scripts/check-app-env.sh`, `scripts/make-test-venvs.sh`, `scripts/check-wave-ownership.py`, `.github/workflows/kernel-tests.yml` (CI jobs `corpus-minimal`, `corpus-app-env`, `corpus-full`, matrix + Qiskit-2 leg, minimal-job command, pytest-cov with `--cov-fail-under` per new package) | the corpus passes in all three envs with zero unexpected statuses; each PRD 15 feature adds its programs (RED) in its own directory before implementing; `check-wave-ownership.py` passes on §7 and on every spec's ownership table |
| **R-D** Corpus golden + wave tooling | scout corpus + glob loader (per-unit directories), `make-test-venvs.sh`, `check-wave-ownership.py`, sole owner of `kernel-tests.yml` this wave (R-C/R-E hand their lines), pytest-cov gates | §5.1 |

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


### 5.3 CI gates (release blockers)

| Gate | Job | Passes when |
|---|---|---|
| Kernel full | `pytest` (3.12 / Qiskit 1.x) + `pytest-qiskit2` (3.13 / Qiskit 2.x) | whole suite green incl. `physics` markers |
| Kernel minimal | `pytest-minimal-venv` | whole `kernel/tests` green with only `requirements.txt` |
| Corpus | `corpus-minimal`, `corpus-app-env`, `corpus-full` | zero unexpected statuses; `xfail(strict)` ledger empty at release |
| Frontend | `npm test`, `tsc -b`, `eslint` (0 errors) | — |
| Playwright stub | `lab-e2e-stub` (chromium + chromium-laptop; every non-`@qec`, non-`@real` spec) + `qec-frontend.yml` (`@qec`) | every PRD 15 spec green; screenshots within 3 % |
| Playwright real | `real-kernel-e2e` (`dev` and `minimal` venvs; app-env venv nightly) | `@real` specs green incl. one per idea (§6, deterministic paths) — gate from Wave 1 on |
| Coverage | pytest-cov `--cov-fail-under=80` per new kernel package (R-D's workflow); vitest `coverage.thresholds` per new `src/` directory (X) | ≥ 80 % |
| Ownership | `scripts/check-wave-ownership.py` on §7 and the spec ownership tables | no two units in a wave share a file; no spec table contradicts §7 |
| Packaged smoke (G3) | nightly + pre-tag `packaged-app-smoke` (installs the **`release.yml` artifact**, which is built on `ubuntu-22.04`, onto `ubuntu-24.04` — the same `.deb` users get, not a separate 24.04 build; `.deb` into a clean `$HOME`, `xvfb-run` + `tauri-driver`) | managed venv created, `environment_report.healthy`, kernel ready < 20 s, Bell + lab ansatz run, `nuclei.log` has startup lines, `nuclei --version` exits 0 |
| Owner-env | `scripts/check-app-env.sh` at release | corpus green against the freshly built bundle's `kernel/` with the shell's exact pip lists |

---


## Audit items you close (docs/research/PRD_15/00_RELIABILITY_AUDIT.md)

### R-21 (Low-Med) Test-infrastructure gaps that hide the above
- `tests/e2e/qec-import.spec.ts` fails on this box: `Real QEC Data Engine exited before readiness ... No module named 'websockets'`; `support/qecDataEngine.ts:75` defaults to system `python3` unless `NUCLEI_E2E_PYTHON` is set. Default it to the repo `.venv` or skip with an explicit reason.
- On a managed-venv-like env (no pyarrow/duckdb/jsonschema/stim), `pytest kernel/tests` has 11 collection errors (`kernel/tests/qec_data/*`, `test_qec_data_schemas.py`, `test_qec_import_chunk_schemas.py`: `ModuleNotFoundError: duckdb|pyarrow|jsonschema`) and 6 docs-fixture failures (`test_docs_fixtures.py`: `environment`, `qec_generate`, `qec_decode_sample`, `qec_studio`, `lab_discovery_evaluators`, `qec_campaign_start_invalid` assume stim is installed). The `pytest-minimal-venv` CI job hides this by running only `test_discovery_optional_deps.py` + `test_trainability_*.py`.
- `cargo test --lib` appears to touch the real `~/.nuclei/runtime`: after I ran it, `kernel-owner.json` (the shell's ownership record for the owner's running app, which also had pid 2587203) was gone while `kernel.json` was unchanged. I could not confirm which test; `kernel_ownership::runtime_dir()` (`kernel_ownership.rs:31-41`) falls back to `$HOME/.nuclei/runtime` in debug builds when `NUCLEI_RUNTIME_DIR` is unset, and `kernel_legacy::tests::live::*` exercise it. Tests must set `NUCLEI_RUNTIME_DIR` to a tempdir. Side effect on the owner: that app instance can no longer prove it owns its kernel for stale-kernel reaping; restarting the app rewrites it. I tried to restore the 27-byte file and was blocked by the permission guard, so I left it as is.


## Controller rulings for this unit (binding)
- You are the SOLE owner of .github/workflows/kernel-tests.yml in Wave 0. Include R-C`s handed lines (a pytest-qiskit2 job: Python 3.13 + qiskit>=2,<3 + qiskit-aer, whole kernel suite) and R-E`s minimal-job command (pytest-minimal-venv runs the WHOLE kernel/tests with only kernel/requirements.txt + pytest deps). Those jobs may be red until R-C/R-E merge; that is expected.
- Seed corpus: the 78-program research corpus, kernel client and repro scripts the scout left in ~/nuclei-handoff/scout-linux/ (read its README/notes first). kclient.py becomes kernel/tests/_kernel_client.py. Learn-mode content (lessons/challenges/capstones) is OUT of scope: Learn mode is being deprecated; do not add Learn programs.
- Expected statuses describe the CURRENT behaviour on this base; programs that hit a known bug are xfail(strict=True) tagged with the R-id (R-1 ... R-22) so the fixing unit flips them. Envs: min (kernel/requirements.txt only), qk2 (py3.13 + Qiskit 2.x), full (dev .venv).
- Any conftest/fixtures you need go in kernel/tests/research_corpus/ (your dir). kernel/tests/conftest.py belongs to R-E this wave — do not edit it.
- scripts/check-wave-ownership.py must parse the master §7 run tables and §5.1/§5.2 owned-files columns and the spec ownership tables; run it on the current plan and record its output in your report (findings in the PLAN are reported, not fixed by you).
