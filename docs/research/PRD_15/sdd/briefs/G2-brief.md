# Brief — PRD 15 unit G2

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **G2** Real-kernel harness | §5.2 (on-disk fixture copies, glob fixture registry, dev origins, `lab-e2e.yml`) | §5.2 list |

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


### 5.2 Real-kernel e2e harness (G2) — unit **G2** (Wave 1b)

- DEV-only `?realKernel=ws://127.0.0.1:<port>&realKernelToken=<t>` branch in `createE2eFixtureBridge` returning `{...base, getPlatform: () => 'desktop', startKernel, stopKernel, getKernelAuthToken}`; `src/config/kernel.ts` reads the port from the query in DEV.
- **On-disk fixture projects.** The in-memory fixture bridge cannot satisfy a real kernel: every v1.4 request carrying `project_root` is validated server-side as an existing absolute directory, and exports written through the bridge never reach disk. In `?realKernel` mode the Playwright global setup **copies `tests/e2e/fixtures/<project>` to a temp dir**; the bridge reads and writes that on-disk copy through a node-side fixture server (a Playwright `route` on `/__fixtures/**`) and reports its absolute path as the `project_root` sent to the kernel, so the qkernel CSV dataset, deploy/symmetry file paths, `.dem` sources and R-9 sibling-import corpus programs all run, and exports are asserted on disk.
- `NUCLEI_KERNEL_DEV_ORIGINS` (comma list) in `kernel/auth.py` so vite on 4173 is accepted — honoured **only when the DEV flag is set**, accepting only `http://localhost:<port>` and `http://127.0.0.1:<port>` patterns (any other host rejected), and `configure_kernel_env` (R-C) removes it in release builds; tests in G2's own `kernel/tests/test_kernel_auth_dev_origins.py` (ignored without DEV, non-loopback rejected, release env strips it) — `test_kernel_auth.py` stays F-1's.
- The e2e fixture registry becomes glob-based (`src/platform/e2eFixtures/index.ts`: `import.meta.glob('../../tests/e2e/fixtures/*/**', {query: '?raw', eager: true})`), so FE units add fixture files without editing the registry.
- The **17** non-bridge `@tauri-apps/*` importers (`App.tsx`, `diracStore`, `EnvironmentPanel`, `FrameworkSetup`, `UpdateBanner`, `useDiracAgent`, `environment.ts`, `experimentFs.ts`, `qecStudyFs.ts`, …) are shimmed behind the bridge by **F-3 in Wave 1a** (the shim list, with the owner F-3 for every file, lives in `docs/research/PRD_15/R_EXECUTION_MODEL.md` §G2); G2 only consumes them.
- Playwright project `real-kernel` (`playwright.config.ts`): global setup picks a free port, spawns `python -m kernel.server` from the chosen venv (`NUCLEI_E2E_VENV` ∈ `dev`, `app-env`, `minimal`), waits for the ready line, exposes port + token, kills on teardown. Specs tagged `@real`, each asserting visible RUNNING → result/error states.
- `?e2eOpen=<fixture path>` in the fixture bridge loads a fixture file into the editor target so Lab specs run on the fixture, not the default Bell buffer.
- CI: two jobs in a new `.github/workflows/lab-e2e.yml` (created by G2, later lists appended by X): `lab-e2e-stub` (every non-`@qec`, non-`@real` spec, both viewport projects — `trainability.spec.ts` and `discovery.spec.ts` never ran in CI before) and `real-kernel-e2e` (`dev` and `minimal` venvs). Both are §5.3 gates from Wave 1 on.
- Owned files: `src/platform/e2eFixtureBridge.ts`, `src/platform/e2eFixtures/{index,labProject,qecProject}.ts`, `src/config/kernel.ts`, `kernel/auth.py` (dev origins only), `kernel/tests/test_kernel_auth_dev_origins.py`, `playwright.config.ts`, `tests/e2e/support/realKernel.ts`, `tests/e2e/support/fixtureServer.ts`, `tests/e2e/real/*.spec.ts` (audit list 1–6), `.github/workflows/lab-e2e.yml`.


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


## Controller rulings for this unit (binding)
- Wave 1 starts from the merged Wave 0 base (Track R kernel done: run-worker pool, adapters, corpus, landlock sandbox). Read docs/research/PRD_15/R_EXECUTION_MODEL.md for the run model.
- Learn mode is deprecated: no Learn-mode work.
- Add corpus programs (if your unit executes user code) under kernel/tests/research_corpus/<your-unit>/.
- Real-kernel specs 1-6 come from the audit G1/G2 list (docs/research/PRD_15/00_RELIABILITY_AUDIT.md §7) and must cover the Track R behaviours now in the kernel (no-measure exact probabilities, library gates, Stop/run_cancel, sys.exit survival, sibling import from project_root, unbound parameters prompt).
- The scout`s proof-of-concept is in ~/nuclei-handoff/scout-linux/e2e-poc/.
- Run Playwright on this box with chromium (npx playwright install chromium if needed).
