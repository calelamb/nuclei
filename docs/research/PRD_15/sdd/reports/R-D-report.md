# R-D report: research-corpus golden (G0) + wave tooling (Wave 0a)

Branch `prd15/r-d` (worktree `.worktrees/prd15-u/r-d`), base `b9e3378`, head `349c237`.

Status: DONE_WITH_CONCERNS (concerns at the end; none block the unit).

## Commits

```
6385e93 test: research-program corpus golden (G0) driven through the real authenticated kernel
f079dd9 chore: wave tooling (make-test-venvs, check-app-env, check-wave-ownership)
957486b ci: corpus jobs, Qiskit 2 leg, whole-suite minimal venv, coverage and ownership gates
349c237 test: let the kernel client launch via python -m kernel.server
```

## What was implemented

| Deliverable (brief) | Where |
|---|---|
| Kernel client (from `kclient.py`) | `kernel/tests/_kernel_client.py` |
| Glob loader | `kernel/tests/research_corpus/loader.py` |
| Case runner, kernel pool, golden comparison, env probe, Xvfb | `kernel/tests/research_corpus/runner.py` |
| 78-program scout corpus with `expected.yaml` per env | `kernel/tests/research_corpus/scout/` |
| Resource gates | `kernel/tests/research_corpus/gates/` (g01 30 qubits, g02 22-qubit frame size, g03 `plt.show()` with a display, g04 queued parses) |
| Corpus test driver | `kernel/tests/test_research_corpus.py` |
| Tests of the tooling | `research_corpus/test_loader.py`, `test_runner_helpers.py`, `test_kernel_client.py`, `test_check_wave_ownership.py` |
| `scripts/make-test-venvs.sh` | `full` (3.12 / Qiskit 1.x + optional stack), `qk2` (3.13 / Qiskit 2.x), `minimal`, `app-env` (pip lists parsed out of `frameworks.rs`) |
| `scripts/check-app-env.sh` (G4) | `python -m venv` + the shell's lists, runner kept in a separate venv, corpus env `qk2` against `--kernel-dir` (default: built bundle, else repo `kernel/` with a warning), `--release` also requires an empty xfail ledger |
| `scripts/check-wave-ownership.py` | master §5.1/§5.2/§7 + spec ownership tables; wave/run exclusivity with glob overlap, spec-vs-master containment, spec wave labels, §5 vs §7 consistency, `--scope`, `--json`; stdlib only |
| `.github/workflows/kernel-tests.yml` | jobs `corpus-minimal`, `corpus-app-env`, `corpus-full`, `pytest-qiskit2`, `pytest-minimal-venv` (now the WHOLE `kernel/tests`), `wave-ownership`, per-package 80 % coverage gate (applies when `kernel/<pkg>` exists) |

How the corpus works (see `research_corpus/README.md`): every `research_corpus/<unit>/expected.yaml` is a unit found by glob. An entry states what the kernel *should* do per phase (`parse`, `execute`), for each env, plus `healthy_after` (the same socket still answers the next parse), `max_seconds`, `max_frame_bytes`, optional golden `facts` (framework, qubit count, depth, gate count, probability count, shots, metrics, `seed_honored`). Known failures carry `xfail: {id: R-n | [R-n, R-m], reason, current}`. The test applies `pytest.mark.xfail(strict=True, raises=CorpusMismatch)`; a known-bad program that fails in a way its `current` block does not describe raises `CorpusDrift` (a real failure, not an xfail), so a bug cannot silently change shape. A later unit flips a scout entry from its own directory with `<unit>/overrides.yaml` (`<id>: {xfail: null}`), so it never edits R-D files. Directory programs (`programs/<id>/main.py` plus siblings) are copied to a temp dir and `$PROJECT` in `options.request` becomes that path (sibling-import and `project_root` programs for R-B).

Corpus result on this base (current behaviour recorded, all three envs): **142 passed, 2 skipped, 31 xfailed, 0 unexpected** in each of min (`minimal` venv), qk2 (`app-env` venv, Python 3.13 / Qiskit 2.6) and full (`full` venv); `check-app-env.sh` also ran green (57 passed, 2 skipped, 31 xfailed). The 2 skips are the release-ledger test and `g03` (no Xvfb on this box).

xfail ledger (programs per env; the same in all three): R-1 8, R-2 8 (4 own + 4 shared with R-3), R-3 5, R-4 3, R-6 1, R-7 1, R-8 1, R-10 1, R-11 3, R-12 1, R-13 3, R-20 1, R-22 1. Not xfail by design: R-14 (`q16/q17/q19` on qk2 are recorded as the expected `execution_error`, noted; migration hints are a frontend concern), R-23 items, R-5 and R-9 (need the Lab / `project_root`, R-F and R-B add their own programs).

## TDD evidence

Honest note: the harness classes (loader, runner, client, ownership script) were written before their unit tests, because the corpus has to be run to learn the current behaviour before a golden can be written. The RED/GREEN that matters for the golden itself and for each test file:

* RED (golden): all 78 scout programs with a placeholder "everything is ok" golden, run through the real kernel in env `full`:
  `RED: 48 of 78 programs differ from an all-"ok" placeholder golden`. Expected: the audit documents exactly these failures (R-1 ... R-22).
* GREEN (golden): after recording observed behaviour, desired behaviour for the 31 known bugs, and `xfail(strict)` tags:
  `NUCLEI_CORPUS_ENV=full pytest kernel/tests/test_research_corpus.py kernel/tests/research_corpus` -> `142 passed, 2 skipped, 31 xfailed in 128.67s`; same for `min` (131 s) and `qk2` (140 s).
* Mutation checks that the corpus really bites (temporary `zz_mutation/overrides.yaml`, removed afterwards; also proves overrides work end to end): flipping `q01` to an error status, an `xfail` on a passing program (`q03`, strict XPASS), a changed `current` on `q02` (drift), a wrong golden fact on `q08`, a 10-byte frame limit on `c01`, and removing the `xfail` of `q06` -> 6 failed, 84 deselected. A `NUCLEI_CORPUS_RELEASE=1` run of the ledger test fails with the 13 open R-ids listed.
* Tooling tests (written after the code, mutated by hand): `test_loader.py` (21), `test_runner_helpers.py` (24), `test_kernel_client.py` (12; real kernel: round trip, wrong token -> 4401, foreign Origin -> 403, runtime-dir isolation, process-group kill, startup failure, memory cap, module launch), `test_check_wave_ownership.py` (31; synthetic plans plus a parse check of the real plan). The one flake found (exit code race when the kernel dies at startup) was fixed (`proc.wait` before reading `rc`) and the test run 6 times green.

## Full-suite results

* `full` venv (3.12 / Qiskit 1.4.6 + stim/qdk/etc.), whole `pytest kernel/tests`: `1 failed, 2794 passed, 15 skipped` (10 m 18 s). The failure is `test_trainability_perf.py::test_batched_value_and_grad_meets_target[16-4-64-10.0]`, a wall-clock target that failed while two full suites and other agents were using the 16 cores; it passes alone (`3 passed in 21.85s`). Not related to this unit.
* Repo dev `.venv` (no pyyaml), whole suite: `1 failed (same perf test), 2745 passed, 16 skipped`. The three PyYAML-based modules skip with a reason there; the pure-stdlib ownership tests and the client tests run.
* Other venvs, the corpus + tooling files only: `minimal` 90 passed 2 skipped (then 100 after later additions), `qk2` and `app-env` the same.
* Not run: the whole suite in the minimal venv (it is R-E's job to make it green; the new workflow job runs it), cargo/vitest/tsc (no Rust or TS touched).
* `ruff check --select F,E9,B,UP035` on all new Python: clean.

## `check-wave-ownership.py` run on the current plan (findings are the PLAN's, not fixed here)

```
# 40 master units over 7 waves, 491 file patterns, 4 spec files
[wave-overlap] Wave 0: R-D (run 0a) `kernel/tests/research_corpus/**` collides with R-A (run 0b) `kernel/tests/research_corpus/r_a/**`
[wave-overlap] Wave 0: R-D (run 0a) `kernel/tests/research_corpus/**` collides with R-B (run 0b) `kernel/tests/research_corpus/r_b/**`
[wave-overlap] Wave 1: F-3 (run 1a) `src/components/settings/settingsRegistry.ts` collides with R-G (run 1b) `src/components/settings/**`
[spec-vs-master] 03 (S2+S3) `docs-site/fixtures/lab_symmetry_*.json` and `docs-site/fixtures/lab/symmetry_compile.stream.json` are assigned to X by the master, not S2+S3
[spec-vs-master] 03 (D3) `docs-site/fixtures/lab_deploy_*.json`, `.../lab/deploy_train.stream.json`, `.../lab/deploy_export.stream.json` are assigned to X by the master, not D3
[spec-vs-master] 04 (L3+L4) `docs-site/fixtures/lab_qec_learned_*`, `.../lab/qec_learned_start.stream.json` are assigned to X by the master, not L3+L4
[spec-vs-master] 04 (V1) `docs-site/fixtures/lab_trainability_verify_*`, `.../lab/trainability_verify.stream.json` are assigned to X by the master, not V1
FAILED: 12 finding(s)
```

Suggested plan edits (controller's call): (1) narrow R-D's row to `kernel/tests/research_corpus/{__init__,_support,loader,runner}.py`, `kernel/tests/research_corpus/{scout,gates}/**`, `kernel/tests/research_corpus/README.md`, `kernel/tests/research_corpus/test_*.py` so `r_a/**`, `r_b/**` stay with R-A/R-B; (2) F-3 owns `settingsRegistry.ts` inside `src/components/settings/**` that R-G also owns; give R-G the explicit file list instead of `settings/**`; (3) either list the per-feature `docs-site/fixtures/...` files in the owning units' master rows (as Q1's row does) or drop them from the spec tables and leave them to X. Full output is in `/tmp/claude-1000/.../scratchpad/ownership_output.txt` and reproduces with `python3 scripts/check-wave-ownership.py`.

Because of these findings the new CI job `wave-ownership` is red until the plan is amended.

## Decisions

* Decision: PyYAML is a *test* dependency (not in `kernel/requirements.txt`); the repo dev `.venv` does not have it. The YAML-reading modules skip with a reason when it is missing and `NUCLEI_CORPUS_ENV` is unset; when `NUCLEI_CORPUS_ENV` is set a missing PyYAML is an error, so a corpus CI job can never go green by skipping. CI jobs and `make-test-venvs.sh` install it.
* Decision: the corpus runs against a real kernel only when `NUCLEI_CORPUS_ENV=min|qk2|full` is set (opt-in). The default `pytest kernel/tests` runs only the structural tests, so other units' `pytest kernel` runs are not slowed by ~2 minutes of kernel spawning. The three corpus jobs and `check-app-env.sh` set it. `NUCLEI_CORPUS_PYTHON` / `NUCLEI_CORPUS_KERNEL_DIR` choose the interpreter and kernel directory; the test refuses to run if the interpreter does not match the declared env (Qiskit major, qdk and stim presence).
* Decision: env `qk2` = the desktop app's catalog install (Python 3.13, Qiskit 2.x, qdk, no stim), i.e. the `app-env` venv and `corpus-app-env`. The `qk2` venv from `make-test-venvs.sh` (3.13 / Qiskit 2.x plus the optional stack) is for the `pytest-qiskit2` whole-suite job and is *not* a valid corpus `qk2` interpreter (stim present); the env probe says so.
* Decision: expected entries state what the kernel SHOULD do; today's behaviour is recorded in `xfail.current` (status keys drift-checked). This reconciles "describe current behaviour" with "xfail(strict) tagged with the R-id": a passing program has no xfail, a known bug has desired expectations + xfail.
* Decision: for R-4 the desired Run answer is the distinct error code `unbound_parameters` (audit: "info/unbound_parameters code distinct from simulation_error"); R-11 `too_many_qubits`; R-6 `timeout`; R-7 `user_exit`. If R-A/R-B pick a different wire form they flip the entry via `overrides.yaml`.
* Decision: `q37-two-circuits-first-wins?` was renamed `q37-two-circuits-which-wins` (a `?` in a file name). Program ids are global across units.
* Decision: scout `z04` runs the execute phase only (timeout 40 s: the kernel's own 30 s constant plus margin); `e06`/`e07` use 15 s. The harness kills and restarts the kernel after any program that leaves it unhealthy (hang, `sys.exit`).
* Decision: allocation gates (`q31`, `g01`, `g02`) run only under an address-space cap (Linux `prlimit`, default 8 GiB) and are skipped otherwise, so no corpus run can reproduce the 22 GB blow-up the audit saw. `DISPLAY` is never inherited; the display gate uses Xvfb and a Matplotlib-backend probe.
* Decision: per-package coverage is `pytest --cov=kernel/<pkg>` for packages whose directory exists, then `coverage report --include=kernel/<pkg>/* --fail-under=80` per package (one test run instead of one per package). The package list lives in a workflow `env:` variable for unit X to append to.
* Decision: `check-wave-ownership.py` treats exclusivity per *wave* by default (as the task states) and per run with `--scope run`; a bare `test_*.py` name inherits the previous path's directory only when that directory ends in `/tests`; text in parentheses outside backticks is ignored.

## Self-review findings (all fixed unless listed in concerns)

* `status` was computed before draining trailing frames, so parse errors sent after the snapshot looked "ok": fixed (classify after drain).
* Kernel-exit race in the client (`rc=None`): fixed.
* `OVERRIDE_KEYS` unused constant removed; `ruff` clean.
* Bare-name path inheritance in the ownership parser mis-assigned `CLAUDE.md`, `vitest.config.ts`, `playwright.config.ts` and a "(from `kclient.py`)" note: fixed with the `/tests` rule and parenthetical stripping; wave-6 units without a file column are now registered so spec rows naming `REV-P` resolve.
* Files: loader 370, runner 403, ownership script 506 lines (all < 800); functions are under 50 lines except a few table-driven test bodies.

## Concerns (DONE_WITH_CONCERNS)

1. The plan has the 12 ownership findings above; `wave-ownership` CI job is red until fixed. R-A/R-B are told to add programs under `research_corpus/r_a|r_b/`, which collides with R-D's `research_corpus/**` row.
2. Wave 0b units must flip scout entries: either edit `scout/expected.yaml` (R-D-owned) or, preferred and requiring no cross-unit edit, add `research_corpus/<unit>/overrides.yaml`. R-A/R-B should be told this. Entries whose desired wire form is a guess: R-4 (`unbound_parameters` as an error code), R-13 (`if_test`/`initialize`/`unitary` should run under Aer).
3. `g03-plt-show-with-display` (R-12) could not be verified here: no Xvfb on this box. It is skipped without Xvfb or without a GUI Matplotlib backend; its `xfail` (a hang -> `timeout`) is taken from the audit, not observed. If CI's backend passes the program, strict xfail will flag it (XPASS) and the entry should be corrected.
4. The CI workflow could not be run (no GitHub here); it was validated as YAML and every command it uses was run locally in equivalent venvs. `pytest-qiskit2` and the whole-suite `pytest-minimal-venv` will be red until R-C / R-E merge (expected per the ruling). `corpus-app-env` needs `python -m venv` and pip network access; the Xvfb install step assumes `apt`.
5. Corpus timing is dominated by two hang programs (`z04` 40 s, `e06` 2 x 15 s); each env takes ~2.2 minutes.
6. `test_trainability_perf` flakes under heavy parallel load (not this unit).
7. `scripts/check-app-env.sh` defaults to the repo `kernel/` when no built bundle exists (warns); at release pass `--kernel-dir <bundle>/kernel --release`.

## Fix report (review r1)

Finding (Important): `scout/expected.yaml` `q31-26-qubit-ghz-too-big` ran a 26-qubit execute without `needs_memory_limit` (uncapped on macOS / Linux without prlimit), and its `error:too_many_qubits` expectation plus R-11 xfail depended on the host (the R-11 policy budget is min(25% of RAM, setting), so 26 qubits at 1 GiB per copy can be allowed on a large host).

Changes (only `kernel/tests/research_corpus/scout/expected.yaml`):
* Added `options: {needs_memory_limit: true}`, so q31 is skipped wherever the kernel cannot be address-space capped, matching the report's stated decision for the allocation gates.
* Removed the host-dependent `execute: error:too_many_qubits` expectation and the R-11 xfail. The execute status is now unconstrained; q31 still asserts parse ok, the 26-qubit snapshot facts, and `healthy_after` (the kernel answers a parse after the run, whatever it did). The refusal check stays on `g01` (gates unit), which is the host-independent R-11 gate (a 30-qubit circuit exceeds any plausible budget). A comment in the entry records this.
* R-11 remains in the xfail ledger through g01 and g02, so the release gate still blocks until R-11 lands.

Verification (PyYAML supplied via PYTHONPATH from a scratch `--target` dir; the shared .venv was not modified):
* `pytest kernel/tests/research_corpus kernel/tests/test_research_corpus.py -q` (no kernel) -> `92 passed, 2 skipped` (loader/validate/helpers/ledger tests).
* `NUCLEI_CORPUS_ENV=full pytest kernel/tests/test_research_corpus.py -q -k "q31 or g01 or g02"` -> `1 passed, 2 xfailed` (q31 passes under the cap; g01/g02 xfail as before).
* `NUCLEI_CORPUS_ENV=full pytest kernel/tests/test_research_corpus.py -q` -> `58 passed, 2 skipped, 30 xfailed in 122.90s`.
