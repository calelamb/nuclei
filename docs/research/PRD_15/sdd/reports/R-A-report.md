# R-A report: adapters (Wave 0b, Track R)

Branch `prd15/r-a`, base `ba46f42`, one commit `f4c4b1e` (status: DONE_WITH_CONCERNS, see Concerns).

## What was implemented

- **R-1** `qiskit_adapter.simulate` / `cirq_adapter.simulate`: a circuit with no measurement
  instruction (Qiskit: no `measure` anywhere, including control-flow blocks; Cirq: no
  `cirq.is_measurement` op) returns the state vector, exact probabilities and Bloch data with
  `measurements = {}`, `measurements_source: "none"`, `probabilities_exact: true`. No `measure_all`
  is ever added, the user's circuit is not mutated. Measured circuits report
  `measurements_source: "sampled"`. `probabilities_exact` is `false` for mid-circuit measure / reset /
  control flow / Kraus (Qiskit) and for non-terminal measurement or non-unitary ops such as noise
  channels (Cirq), because the state vector is then one trajectory.
- **R-2** (`kernel/adapters/_qiskit_aer.py`) both Aer runs go through
  `transpile(circuit, backend, optimization_level=0)`. Anything that still cannot run raises
  `UnsupportedInstructionError` (code `unsupported_instruction`, `.instruction` names the gate; never an
  `AerError` text). Opt-in snapshot block expansion: `extract_snapshot(circuit, expand_blocks=True)`
  (`_qiskit_expand.py`) replaces each composite block by its body (looking through the one-instruction
  wrapper `qc.append(QFT(3))` creates), standard gates stay single boxes, capped at
  `MAX_EXPANDED_GATES = 2000`; a skipped expansion is reported in the new optional
  `CircuitSnapshot.notes`.
- **R-4 (kernel side)** `kernel/adapters/binding.py`: `bind_parameters(circuit, parameter_values |
  random_seed=) -> (circuit, bound_at)` for Qiskit and Cirq, plus `free_parameter_names`.
  `kernel/adapters/errors.py`: `UnboundParametersError(ValueError)` with `code="unbound_parameters"`,
  `severity="info"`, `.parameters`. Both adapters' `simulate` raise it (no longer the Trainability Lab
  wording).
- **R-13** `_qiskit_params.py`: `initialize` -> `0.0` + `<complex[4]>`, basis-state initialize -> `<'01'>`,
  `unitary` -> `<unitary 4x4>`, `if_test` -> `<block>`; per-instruction failure degrades to a
  `<unavailable>` placeholder plus a note; `FrameworkAdapter.try_extract_snapshot()` returns
  `(None, "snapshot unavailable: <why>")` instead of raising.
- `SimulationResult` gains optional `measurements_source`, `probabilities_exact`, `bound_at` (omitted from
  the wire when `None`, so Q#/CUDA-Q/Stim results are byte-identical). `CircuitSnapshot.notes` likewise.

## Decision lines

- Decision: `bind_parameters` accepts the wire shape `{"random_seed": n}` as a mapping *or* `random_seed=`;
  a circuit with a parameter literally named `random_seed` treats the mapping as values. Seeded draws are
  uniform on [0, 2*pi) in natural name order. Names the circuit lacks are ignored, names it needs but the
  request lacks raise `UnboundParametersError` listing them.
- Decision: no `sampled_from_statevector` path implemented (brief says "optionally"); the enum value is
  documented on the dataclass only.
- Decision: the new result fields are set only by the Qiskit and Cirq adapters. Q#, CUDA-Q and Stim leave
  them `None` (omitted), not in scope.
- Decision: `PauliEvolutionGate` simulates as its default synthesis (one-rep Lie-Trotter), which is the
  circuit Aer and hardware run. On Qiskit 2.x a bare `Statevector(qc)` evolves it exactly instead, so the
  test oracle decomposes first. (The pre-existing `test_trainability_convert_composite::
  test_pauli_evolution_gate_with_a_symbolic_time` fails on Qiskit 2.x at the base commit for the same reason.)
- Decision: complex amplitudes of one op collapse to one `<complex[N]>` entry (N = amplitude count) rather
  than N repeated labels; `None` params (absent `else` block) are dropped.
- Decision: `UNBOUND_PARAMETERS_MESSAGE` stays in `models/snapshot.py` (an existing test pins the text), with
  a comment marking it legacy.
- Decision: parameter names are ordered naturally (`w[2]` before `w[10]`).

## TDD evidence

RED (before any implementation), `.venv/bin/python -m pytest kernel/tests/test_adapters_research_paths.py -q -x`:
```
E   ModuleNotFoundError: No module named 'kernel.adapters.binding'
1 error in 0.18s
```
Expected: `binding`/`errors` and the new fields did not exist. After creating them and wiring Qiskit, a second
RED for Cirq: `test_execute_no_measurements_cirq` failed with
`ValueError: Circuit has no measurements to sample.` (the R-1 symptom), and the expansion tests failed
(`'QFT' not in ['H', 'QFT']`, empty `notes`) until `_qiskit_expand.py` looked through the QFT wrapper.

GREEN, dev `.venv` (Qiskit 1.4.6): `75 passed`. Same file on all venvs (`scripts/make-test-venvs.sh path <env>`):
qk2 (Qiskit 2.6.0, py3.13), app-env (2.6.0), minimal (1.4.6), full (1.4.6): all pass (74 at the time; 75 after the
natural-order test, re-run on dev, qk2, minimal).

## Full-suite results

- Research corpus, `NUCLEI_CORPUS_ENV=full` / `min` / `qk2` (app-env venv): each
  `80 passed, 2 skipped, 15 xfailed`, zero unexpected statuses. 15 scout xfails flipped through
  `kernel/tests/research_corpus/r_a/overrides.yaml` (c02, c08, c14, q02, q05, q06, q07, q14, q15, q20, q25,
  q26, q27, q28, q36); 7 new `ra-*` goldens in `r_a/expected.yaml`. Still xfail by design: R-4
  (q04/q10/c03, R-B wires the code into the execute path) and R-3+R-2 (q09-q13, blocked on R-3 detection;
  with an `import qiskit` prefix q09/q11/q12/q13 run and q10 returns the unbound error).
- Kernel pytest, dev `.venv`: `6 failed, 2965 passed, 17 skipped`; minimal venv `6 failed, 2310 passed, 93 skipped`;
  qk2 venv `7 failed, 3013 passed, 16 skipped` (the 7th is the pre-existing Qiskit-2 PauliEvolution failure above,
  verified against a `git archive` of the base commit). The 6 failures are caused by my change and live in files
  I do not own, see Concerns.

## Files changed

`kernel/adapters/{base,cirq_adapter,qiskit_adapter}.py` (modified); new `kernel/adapters/{binding,errors,
_qiskit_aer,_qiskit_expand,_qiskit_params}.py`; `kernel/models/snapshot.py`;
`kernel/tests/test_adapters_research_paths.py` (75 tests); `kernel/tests/research_corpus/r_a/**`
(`expected.yaml`, `overrides.yaml`, 7 programs). Largest source file `qiskit_adapter.py` is 250 lines.

## Self-review findings (fixed)

- Parameter names sorted lexicographically (`θ[10]` before `θ[2]`): switched to natural order, test added.
- Cirq adapter had its own `sorted(cirq.parameter_names(...))`: now uses the shared `free_parameter_names`.
- Dead helper class and a vacuous assertion in my first test draft removed; the QFT expansion test now asserts
  the exact `CP` count.
- Test warnings: module-level `filterwarnings` for Qiskit's pending-deprecation library classes and Aer's own
  `Instruction.condition` warning (not behaviour under test); function-form library (`QFTGate`, `efficient_su2`,
  ...) is covered by a separate parametrized test.

## Concerns (why DONE_WITH_CONCERNS)

1. **Six existing tests in files I do not own now fail**, all expected consequences of the wire change. The
   exact fix is in `/home/calelamb/Desktop/code/nuclei/.worktrees/prd15/.superpowers/sdd/PRD_15_QUANTUMNESS_LAB/reports/R-A-unowned-files.patch`
   (verified green against this branch):
   - `docs-site/fixtures/{execute_bell_qiskit.responses,execute_metrics.responses,execute_params_seed.session,
     hardware_simulator.session}.json` need `"measurements_source": "sampled", "probabilities_exact": true` in the
     result `data` (the docs-fixtures replay matches key sets exactly). The `kernel-api/messages-execution.mdx` and
     protocol-changelog text should document the new fields (docs owner).
   - `kernel/tests/test_trainability_adapters_unbound.py` (2 tests) asserted the old Trainability-Lab wording.
     R-B must rewrite them anyway when it classifies `UnboundParametersError` as `unbound_parameters`.
2. **R-B wiring needed** (executor.py/server.py are not mine): catch `UnboundParametersError`/
   `UnsupportedInstructionError` and send `{type: "error", code: exc.code, severity: exc.severity,
   parameters: exc.parameters, ...}` (today both surface as `simulation_error` with the class path in the message,
   so q04/q10/c03 stay xfail R-4); call `bind_parameters` before `simulate` and put `bound_at` on the result; use
   `adapter.try_extract_snapshot()` in parse/execute so a snapshot failure shows "snapshot unavailable" and still
   runs; pass `expand_blocks` to `extract_snapshot` if the UI wants it (the base abstract signature is unchanged).
3. Shared venv cache (`~/.cache/nuclei-test-venvs`) is used by other units too; nothing in it was modified beyond
   the scripted build.

## Fix report, review round 1

New head: 11a536a7e9bc81c30a956748cb1fecefe1cba9a2 (on top of f4c4b1e).

### What changed
- **I2** `_qiskit_aer.is_deterministic` now walks the circuit tracking touched qubits. An op whose definition
  (recursively) contains `reset` (`initialize`) is exact only while every qubit it acts on is untouched; a leading
  `initialize` stays exact, `h; cx; initialize([1,0],[0])` reports `probabilities_exact=False`. Plain `Gate`s are
  skipped without touching `.definition`.
- **I3** `extract_snapshot(self, circuit_obj, *, expand_blocks=False)` on the abstract base and on the Cirq, CUDA-Q,
  Stim and Q# adapters (ignored where meaningless). `try_extract_snapshot(circuit_obj, *, expand_blocks=False)` replaces
  `**options` and logs the traceback (`logger.warning(..., exc_info=True)`). The kwarg is forwarded only when True, so
  third-party/fake adapters with the old one-argument signature keep working.
- **I4** `_named_in_message(error, known)` accepts a culprit only if it is an instruction name in the circuit
  (`_walk`); `prepare_for_aer` tries the message first, then `_find_unsupported`, otherwise re-raises the original.
  `run_on_aer` applies the same rule.
- **I1** Applied `reports/R-A-unowned-files.patch` unchanged (4 docs-site fixtures gain the two result keys; 2 PRD 14
  asserts relaxed, `simulation_error` kept). These files are outside R-A's brief ownership; touched because the task
  assigned fixing I1 and the branch cannot be green otherwise. Docs text is NOT written (see below).

### Covering tests (added to kernel/tests/test_adapters_research_paths.py, 88 tests now)
`test_initialize_after_entangling_is_not_reported_as_exact`, `test_leading_initialize_stays_exact`,
`test_initialize_on_an_untouched_qubit_beside_a_used_one_stays_exact`,
`test_transpile_failure_that_names_no_instruction_is_not_blamed_on_one`,
`test_transpile_failure_naming_a_circuit_instruction_is_unsupported`,
`test_every_adapter_accepts_expand_blocks[6 adapters]`, `test_try_extract_snapshot_takes_expand_blocks_uniformly_on_cirq`,
`test_try_extract_snapshot_logs_the_traceback`. RED verified against the previous adapters: 9 failed, 79 passed.

### Commands and output
- `./.venv/bin/python -m pytest kernel/tests/test_adapters_research_paths.py -q` -> 88 passed
- `./.venv/bin/python -m pytest kernel/tests -q` (dev venv, whole kernel suite) -> 2985 passed, 17 skipped, 0 failed
- corpus full / min / qk2(app-env): `80 passed, 2 skipped, 15 xfailed` each, no unexpected statuses
- qk2 venv: test_adapters_research_paths + test_trainability_adapters_unbound + test_docs_fixtures -> 144 passed
- min and app-env venvs: test_adapters_research_paths -> 88 passed

### Not fixed
- I1 docs: `kernel-api/messages-execution.mdx` and the protocol changelog (new result fields, `CircuitSnapshot.notes`,
  `unbound_parameters`/`unsupported_instruction` codes) need an assigned docs owner; left out to avoid conflicts with R-B.
- Minors M1-M10 untouched (out of scope for this round).

## Fix round 2

Finding: `prepare_for_aer` regressed R-2 for an unsupported instruction nested in a composite gate (`known` was built
with `_walk`, which does not enter gate definitions, so the transpile culprit was rejected and the raw TranspilerError
escaped).

- `kernel/adapters/_qiskit_aer.py`: new `_instruction_names(circuit)` walks control-flow blocks AND `op.definition`
  recursively (depth cap 4, same as `_contains_reset`); used for `known` in `prepare_for_aer` and `run_on_aer`.
  The I4 guard is unchanged: a `name=` repr that is not an instruction anywhere still re-raises the original error.
- Qiskit 2.x words the failure `HighLevelSynthesis is unable to synthesize "mystery"` (no `name='...'`), so a
  `_SYNTHESIS_FAILURE_V2` pattern was added (also gated by `known`).
- Test: `test_unsupported_instruction_nested_in_a_composite_gate_is_named`. RED on both Qiskit 1.4.6 and 2.x (TranspilerError); GREEN on both.
- Results: research_paths 89 passed on dev (1.4.6) and qk2; full kernel suite 2986 passed, 17 skipped.
