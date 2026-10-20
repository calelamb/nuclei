# W0b integration report (branch prd15/w0b-int, base ba46f42)

Commits: 1492aa4 merge R-A, 0560ef6 merge R-B, fec721c (wiring + overrides + ownership + integration tests), 84b228a (duck-typed adapter tolerance, unbound tests).

## Conflicts
None. Both merges were clean (no overlapping files; R-B edited executor/server, R-A the adapters/models).

## Corpus override changes
- r_b/overrides.yaml: removed the q09-q13 stanzas (R-2/R-4 re-adds).
- r_a/overrides.yaml: added `{xfail: null}` for c03, q04, q09, q10, q11, q12, q13 (merged behaviour passes; they were strict XPASS). Corpus now zero unexpected statuses in full, min, qk2.

## Wiring findings
- executor._bind_parameters already called the real kernel.adapters.binding (bound_at on result via result_extras): OK, verified through server.
- unbound_parameters (info, parameters[]) and unsupported_instruction (instruction) reach the wire with and without run_id: OK, tested.
- Lean >16q path: run_memory._aer_runner had an ImportError fallback; replaced by a direct import of prepare_for_aer/run_on_aer; spy test proves it is taken, plus a 17q QFT library-gate run.
- GAP FIXED: executor.execute used extract_snapshot, so a snapshot failure blocked Run with adapter_error. Now uses try_extract_snapshot(expand_blocks=False) (tolerating duck-typed adapters), plans memory from a width-only stand-in snapshot, and sends `snapshot_error` on the snapshot frame (additive). Test: in-process + through the server (subclass whose num_clbits raises only for extract_snapshot). Note: RED was observed for the in-process behaviour via the original code path; not re-run as a separate red commit.
- Updated two R-A tests that asserted the pre-wiring `simulation_error` for unbound circuits to `unbound_parameters`/info.
- New: kernel/tests/test_wave0b_integration.py (11 tests).

## Ownership
docs/research/PRD_15_QUANTUMNESS_LAB.md section 5.1: R-B cell lists all new run_* modules, preview_static, project_paths, models/errors, hardware/simulator_provider, qec/{estimate,materialize}, trainability/handlers, discovery/procrun, test helpers, docs-site fixtures, test_wave0b_integration.py; R-A cell adds test_trainability_adapters_unbound.py. R-B's `run-worker-macos` job in .github/workflows/kernel-tests.yml IS merged (it was not left out); the R-D cell of section 5.1 now records the hand-over of that job to R-B in Wave 0b (fix round 1), so R-D remains sole owner of the file apart from that handed-over job. check-wave-ownership.py: OK (wave and run scope).

## Gate
- dev .venv kernel/tests: 3292 passed, 18 skipped
- full venv: 3356 passed, 98 skipped
- minimal venv: 2642 passed, 185 skipped (ran before last small fix; only executor tolerance changed since)
- qk2 venv: 1 failed, 3355 passed, 98 skipped - FAILED test_trainability_convert_composite.py::test_pauli_evolution_gate_with_a_symbolic_time
- requirements-only Qiskit 2.6.0 venv (uv, py3.12): same 1 failed, 2641 passed, 185 skipped
- The one failure is an R-F (Wave 0a) test: PauliEvolution symbolic-time state mismatch on Qiskit 2; kernel/trainability/convert.py is untouched by 0b, so it is pre-existing, not an integration issue. NOT fixed.
- corpus full: 118 passed, 3 skipped; min: 118 passed, 3 skipped; qk2 (app-env): 118 passed, 3 skipped (skips: release gate, 2 Xvfb-needed)
- npx vitest run: 231 files, 2119 tests passed
- npx tsc -b: clean
- npx eslint .: 0 errors, 4 warnings
- check-wave-ownership.py: OK

## Audit R-ids
Closed (by 0b code, verified): R-1, R-2, R-3, R-4, R-6, R-7 (kernel side), R-8, R-9, R-10, R-11, R-13, R-20, R-22; R-12 closed except the display (Xvfb) test which is skipped here.
Still open / other units: R-5, R-19 (R-F, 0a merged), R-14, R-16, R-17, R-18 (R-C), R-21 (R-E), R-7 shell health check (R-C), R-15 (frontend, Wave 1), R-12 display test (needs Xvfb).

## PauliEvolution fix

Commit 2f444cd on prd15/w0b-int (new commit, no history rewrite).

Cause: the test operator (ZZI, IXX, YIZ) has anticommuting terms. Qiskit 2.x Statevector evolves PauliEvolutionGate exactly; Qiskit 1.x used its definition. The IR (via the gate's own synthesis, default one-rep Lie-Trotter) matched only the latter.

Decision: the converter keeps honouring the gate's own synthesis (reps/SuzukiTrotter already flow through op.definition) and, when any Pauli terms do not commute (or commutation cannot be determined), appends a note: "PauliEvolutionGate 'PauliEvolutionGate' decomposed with <Synthesis> synthesis (reps=<n>); terms do not commute, so the analysed circuit approximates exp(-i t H)". Commuting terms get no note (decomposition is exact). Code: pauli_evolution_note in kernel/trainability/_decompose.py, called from from_qiskit.

Tests: commuting operator compares to exact Statevector on both majors; non-commuting compares to Statevector(qc.decompose(reps=2)) and asserts the note; reps=3 synthesis is honoured and noted. RED on qk2 confirmed (2 new tests failed before the change).

Results: composite file 32 passed on dev .venv (Qiskit 1.4.6) and on qk2 (2.6.0); full kernel suite on qk2 (run from repo root): 3358 passed, 98 skipped.

## Fix round 1
Commits: 7a5c8b6 (kernel fixes + tests), 92f7c1b (docs).

- Critical 1 (stand-in hid measurements): removed _stand_in_snapshot. run_memory.plan_simulation(snapshot|None, ..., circuit=) now reads width and measurements off the circuit (circuit_facts: R-A has_measurements for qiskit, cirq.is_measurement for cirq). Unknown width plans "adapter" (width_known=False); Executor._simulate completes the width from the adapter result (resolve_unknown_width) and shapes it when above 16 qubits, leaving a small result alone. Unknown measurement status for a lean framework also plans "adapter". simulation_method=MPS is honoured under snapshot failure. RED: 10 of 11 new tests failed first. Tests: kernel/tests/test_snapshot_failure_planning.py (18q measured qiskit sampled; mid-circuit never exact; cirq 18q sampled; refusal estimate copies==2 with rerun_mps action; MPS honoured at 30q; unknown width shaped / small left alone).
- Important 2 (bound_at): Executor.result_extras removed; execute sets bound_at via dataclasses.replace together with metrics; _bind_parameters returns (circuit, error, bound_at); run_ops_builtin no longer merges extras. Tests: test_in_process_executor_carries_bound_at, test_lean_result_carries_bound_at, existing pooled test_parameter_values_bind_through_adapters_binding_and_report_bound_at (with and without run_id).
- Important 3 (ownership): master 5.1 R-D cell records the macos-14 run-worker-macos hand-over to R-B in Wave 0b; Ownership paragraph above corrected. check-wave-ownership.py: OK.
- Important 4 (snapshot_error): master 4.2 parse row documents it (as the STRING "snapshot unavailable: <why>" the kernel actually emits, not an object); R-G brief has the hand-off line. No docs-site edit.
- Minor 5: _try_snapshot deleted; execute/parse call adapter.try_extract_snapshot; the stubs in test_executor.py and test_experiment_execution.py subclass FrameworkAdapter.
- Minor 6: dead ImportError branch (parameter_binding_unavailable) removed.
- Minor 7: Executor.parse degrades (snapshot None, no error, executor.snapshot_error); parse_op and run_routes._parse put snapshot_error on the snapshot frame. Tests: test_parse_degrades_like_run, test_a_parse_snapshot_failure_degrades_like_a_run (server wire).
- Also: D13/D25(e) corrected and D26 added in R_EXECUTION_MODEL.md; E305 split gone with the stand-in; test_wave0b_integration.py asserts run_id echo/absence (assert_run_id_echo) and the unused monkeypatch is removed.

Gate (repo root):
- ./.venv kernel: 1 failed, 3304 passed, 18 skipped. The failure, test_run_cancel_kills_within_1s, is a 1 s timing test run while three suites shared the CPU; rerun alone, test_executor_run_path.py: 66 passed.
- minimal venv: 2655 passed, 185 skipped
- qk2 venv: 3369 passed, 98 skipped
- corpus full: 118 passed, 3 skipped; min: 118 passed, 3 skipped; qk2 (app-env): 118 passed, 3 skipped
- check-wave-ownership.py: OK
