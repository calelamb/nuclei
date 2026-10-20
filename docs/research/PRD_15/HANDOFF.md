# PRD 15 handoff (paused 2026-10-19)

Read this first if you are an agent picking up PRD 15, the Quantumness Lab: the owner's quantum-ML program (ideas 1–8) plus Track R, the research-workspace reliability track.

## 1. Where things stand

| Branch (all pushed to `origin`) | Contents | Status |
|---|---|---|
| `feat/prd15-quantumness-lab` | Plan docs + **Wave 0a** merged (units R-D, R-C, R-E, R-F) + the R-D corpus env fix | Reviewed and gated green. **This is the base for everything.** |
| `prd15/w0b-int` | `feat/...` + **Wave 0b** (R-A adapters, R-B warm run-worker pool) + integration fixes | Merged and mostly reviewed. **Fix round 2 (commits `4d18a9d`, `c76329f`) is NOT yet re-reviewed and its gate was interrupted.** |

Waves 1–6 have not started. Wave 1 briefs are prepared.

### Next steps, in order

1. **Gate `prd15/w0b-int`** at `c76329f`:
   - kernel suite from the repo root on `./.venv`, the minimal venv and the qk2 venv;
   - research corpus in full, min and qk2 (app-env);
   - `scripts/check-wave-ownership.py`.

   Commands are in §3.
2. **Scoped Opus re-review** of `92f7c1b..c76329f` against the findings in `sdd/LEDGER.md` (search "W0b-int: fix round 1/5" and "Task Pauli"). The fixer's report section is "## Fix round 2" in `sdd/reports/W0b-int-report.md`; it may be missing or partial because the fixer was stopped mid-gate. The findings it addressed:
   - A1: lean path took `measured` from the snapshot, not the circuit.
   - A2: lean exact path claimed exact for non-deterministic circuits.
   - B1: nested `PauliEvolutionGate` was Trotterised with no note.
   - B2: O(T²) commutation check (needs vectorising and a cache).
   - Minors: A3–A6 and B3–B6.
3. Once green and approved, **merge `prd15/w0b-int` into `feat/prd15-quantumness-lab`** (fast-forward or `--no-ff`), push, and record "Wave 0: COMPLETE" in the ledger.
4. Start **Wave 1**:
   - Run 1a: F-1, F-2, F-3, N1.
   - Run 1b: G2, R-G.

   Briefs are in `sdd/briefs/` and already carry the hand-off rulings. Regenerate a brief with `python3 docs/research/PRD_15/sdd/make_brief.py '<json>'` if the plan changes. Then continue through Waves 2–6 per master §7.

## 2. Authoritative documents

- `docs/research/PRD_15_QUANTUMNESS_LAB.md` is the master plan: §2.1 principles, §4 protocol v1.4, §5 Track R, §6 traceability (ideas 1–8, every acceptance item), §7 waves and file ownership, §8 definition of done, §10 review log.
- The specs (`docs/research/PRD_15/`):
  - `00_RELIABILITY_AUDIT.md`: bugs R-1…R-23;
  - `01`: ideas 1+2;
  - `02`: ideas 3+4;
  - `03`: ideas 5+6;
  - `04`: ideas 7+8;
  - `R_EXECUTION_MODEL.md`: the run-worker pool design, decisions D1–D26, and §8, the list of the 17 Tauri importers F-3 must shim.
- `sdd/LEDGER.md` is the progress ledger. Every `Ruling:` line is a decision made on the owner's behalf; carry them forward, and list them when the work finishes. It also holds the deferred minors to triage at the final review.
- `sdd/briefs/*.md` are the per-unit requirements with their rulings appended; `sdd/reports/*.md` are the implementer reports with TDD evidence; `sdd/reviews/*.md` are the Opus task reviews. The `.diff` review packages were not kept; regenerate them with git.

## 3. How the work is run (owner's process)

- **Subagent-driven development (superpowers SDD):**
  - one Sonnet implementer per unit, each in its own git worktree under `../prd15-u/<unit>` on branch `prd15/<unit>`, branched from the wave's base;
  - one Opus task review (spec + quality) per unit or pair, then a fix round and a scoped Opus re-review;
  - the controller merges units in plan order, runs the gate, and records results in the ledger.
- **Owner's rules:**
  - at most 10 agents per workflow run;
  - Fable for planning/orchestration, Sonnet for implementation, Opus for review and architecture, Haiku only for trivial work;
  - no AI attribution lines in commits;
  - Learn mode is being deprecated, so do no Learn-mode work; PRD 15 targets the Research workspace only;
  - be ground-breaking but scientifically honest: never a fabricated number, never a midpoint of an interval, "not applicable" or "inconclusive" when that is the truth;
  - every feature must be usable end to end in the app.
- **Reusable workflow script:** `sdd/prd15-sdd-run.workflow.js`. It runs parallel implementers, paired reviews, one fix round and a re-review. Pass it `args` of the form `{base, plan, ws, pairs, units:[{key, wt, branch, brief, report, context, effort?}], constraints}`. Before a run, create the unit worktrees and symlink `node_modules` and `.venv` into each from the main PRD 15 worktree.
- **Environment (Linux dev box `cjl`):**
  - Node: run `source ~/.nvm/nvm.sh` (node 24).
  - Kernel dev venv: `.venv` in the worktree (uv, Python 3.12, Qiskit 1.4.6).
  - Test venvs: `scripts/make-test-venvs.sh full|minimal|qk2|app-env`, and `... path <name>` to print an interpreter path.
  - Run kernel suites from the **repo root**: `<python> -m pytest kernel/tests -q -p no:cacheprovider`.
  - Corpus per env: see `kernel/tests/research_corpus/README.md`. min and full are Qiskit 1.x; qk2 must use the **app-env** venv (Qiskit 2, no stim), not the CI qk2 venv.
- **Gate per wave** (master §7, plus a ledger ruling):
  - kernel suite on dev, minimal, qk2, and a requirements-only Qiskit 2 venv;
  - corpus in 3 envs with zero unexpected statuses;
  - `npx vitest run`, `npx tsc -b`, `npx eslint .` (0 errors);
  - `cargo test --lib` when Rust changed;
  - `check-wave-ownership.py` OK;
  - Playwright stub + `@real` from Wave 1.

## 4. Gotchas learned this session

- `.gitignore`'s `.venv/` does not match a **symlink**. The common `info/exclude` now has `/.venv` and `/node_modules`, but check `git ls-files .venv` before any merge.
- R-C widened `kernel/requirements.txt` to `qiskit>=1.2,<3`. The corpus min/full venvs pin `<2` on purpose.
- Timing tests such as `test_run_cancel_kills_within_1s` and `test_trainability_perf` can fail while several suites share the CPU. Rerun them alone before treating them as failures.
- This box has no Xvfb, so the R-12 `plt.show` display tests skip locally and run in CI only.
- Don't use `pgrep -f <path> | xargs kill` for cleanup: the pattern matches your own shell. Filter with `ps -eo pid,args | grep … | grep -E 'server.py|run_worker_main'`.
- The owner's installed Linux app is 0.14.1 (Qiskit 2.6 in its managed venv), and its `nuclei --version` opens the full GUI (R-18, fixed on the branch, not released). Never launch `/usr/bin/nuclei` and never touch `~/.nuclei/runtime`.
- Hand-offs already routed:
  - landlock UI, `origin` on discovery evaluate/audit, IR notes in the certificate, and the settings registry at `src/config/settingsRegistry.ts`: F-3;
  - landlock types: F-2;
  - kernel-restart events, the `unbound_parameters` info prompt and "Diagram unavailable" from `snapshot_error`: R-G;
  - all Track R protocol docs (new result fields, error codes, `snapshot_error`, `run_cancel`): X in Wave 5b.
- R-5 ruling: an unbound second-order ZZFeatureMap reports its data-parameter count plus a `nonlinear_parameter` note. This is Q3's job in Wave 2, through `inspect.py`.
