# R-A review, round 1

Unit: R-A Adapters (Wave 0b). Branch `prd15/r-a`, base `ba46f42`, head `f4c4b1e` (1 commit).
Package: `reviews/R-A-r1.diff` (19 files, +1415/-107).

Verdict: **Needs fixes.** All 19 changed files are within R-A's ownership, and the adapter work covers R-1, R-2, R-4 (kernel side) and R-13. Two problems need fixing before it can be trusted: the honesty flag is wrong for a reachable case, and the branch leaves 6 existing tests red in files R-A does not own. Two more items are fragile.

## Spec compliance (file by file against the brief)

| Owned path | Touched | Notes |
|---|---|---|
| `kernel/adapters/**` | yes | `qiskit_adapter.py`, `cirq_adapter.py`, `base.py` modified; new `binding.py`, `errors.py`, `_qiskit_aer.py`, `_qiskit_expand.py`, `_qiskit_params.py` |
| `kernel/adapters/binding.py` | yes | `bind_parameters(circuit, parameter_values \| random_seed=) -> (circuit, bound_at)` matches the R-B ruling's signature |
| `kernel/models/snapshot.py` | yes | `measurements_source`, `probabilities_exact`, `bound_at`, `CircuitSnapshot.notes` (all omitted from the wire when unset) |
| `kernel/tests/test_adapters_research_paths.py` | yes | 692 lines. Has `test_execute_no_measurements_{qiskit,cirq}`, the 10-gate parametrized library test (with and without measurement), binding bound/unbound, snapshots of initialize/unitary/if_test |
| `kernel/tests/research_corpus/r_a/**` | yes | 7 goldens, `overrides.yaml` flips 15 scout xfails (R-1/R-2/R-13). R-4 entries q04/q10/c03 correctly stay xfail until R-B wiring |

No file outside R-A's ownership was touched.

- Missing: none of R-A's own items. Execute-path wiring (`parameter_values` → `bind_parameters`, `bound_at` on the result, error-frame classification, `try_extract_snapshot` in parse/execute) belongs to R-B by ruling.
- Extra: `CircuitSnapshot.notes` adds a field to the `snapshot` frame that §4.2 does not list. It is omitted when empty, but nothing documents it (Minor M6).
- Misunderstood: none. `sampled_from_statevector` is not implemented. That is acceptable because the audit marks it optional, and the report records the decision.
- Global constraint (8) is not met as delivered: 6 existing tests fail, including the PRD 14 suite `test_trainability_adapters_unbound.py` (I1).

## Important

**I1. Suite regression: 6 existing tests fail in unowned files (constraint 8). Plan gap, needs a controller ruling.**
Where: the wire change in `kernel/models/snapshot.py:59-74` and the new adapter error in `kernel/adapters/qiskit_adapter.py` / `cirq_adapter.py` (`UnboundParametersError` replaces `UNBOUND_PARAMETERS_MESSAGE`).
What: the Qiskit and Cirq `result` payloads now always carry `measurements_source` and `probabilities_exact`. Through the hardware simulator provider, so do hardware results. The docs-fixture replay matches key sets exactly, so four fixtures fail: `docs-site/fixtures/execute_bell_qiskit.responses.json`, `execute_metrics.responses.json`, `execute_params_seed.session.json` and `hardware_simulator.session.json`. Two tests in `kernel/tests/test_trainability_adapters_unbound.py` (PRD 14) assert the old message suffix.
What I checked: neither R-A's nor R-B's brief lists these files, and the master §5.1 rows grepped only assign Lab fixtures to other units, so no Wave 0b unit owns them. `reports/R-A-unowned-files.patch` is correct and minimal: it adds the two keys to each fixture result and relaxes the two message asserts while keeping `simulation_error`.
Why it matters: the branch cannot merge green, and the protocol change has no docs (`kernel-api/messages-execution.mdx`, protocol changelog).
Fix: the controller assigns the patch (to R-A or to the integration merge) and assigns an owner for the docs/changelog text. Do not merge R-A alone.

**I2. `probabilities_exact: true` is reported for a non-deterministic program (mid-circuit `initialize`), which breaks §2.1.4 "honest by construction".**
Where: `kernel/adapters/_qiskit_aer.py:23` (`_NON_DETERMINISTIC`) and `is_deterministic`. `_walk` never looks into definitions, and `initialize` is not in the set.
Verified by a focused run on the dev venv: `qc.h(0); qc.cx(0,1); qc.initialize([1,0],[0])` simulated with seeds 0..5 gives `{'00': 1.0}` on some seeds and `{'10': 1.0}` on others, every time with `probabilities_exact=True`. Aer's `initialize` resets its qubits first, and resetting one half of a Bell pair collapses the other half, so the state vector is one trajectory.
Fix: treat `initialize` (and any op whose definition contains `reset`) as non-deterministic unless every one of its qubits is still untouched at that point. A leading `initialize`, as in q25, stays exact. Add a regression test for the entangled case.

**I3. `try_extract_snapshot(**options)` forwards options that no non-Qiskit adapter accepts, and its blanket `except` turns that programming error into "snapshot unavailable".**
Where: `kernel/adapters/base.py:22-34`. Only `QiskitAdapter.extract_snapshot` accepts `expand_blocks`. The Cirq (`cirq_adapter.py:67`), CUDA-Q (`:95`), Stim (`:65`) and Q# (`:553`) adapters take no options; I checked their signatures.
Why it matters: the report tells R-B to use `try_extract_snapshot` in parse/execute and to pass `expand_blocks` if the UI wants it. A uniform call such as `adapter.try_extract_snapshot(circuit, expand_blocks=flag)` would make every Cirq, Stim, Q# and CUDA-Q diagram disappear behind `snapshot unavailable: extract_snapshot() got an unexpected keyword argument`. The TypeError would also be swallowed without a log or traceback.
Fix: add `*, expand_blocks: bool = False` to the abstract `extract_snapshot` and to every adapter (ignored where it means nothing; all of them are in `kernel/adapters/**`, so R-A owns them). Make `try_extract_snapshot` take explicit keywords instead of `**options`. Keep the traceback in the returned reason or log it.

**I4. The fallback that guesses the unsupported instruction can name the wrong thing.**
Where: `kernel/adapters/_qiskit_aer.py:21`, `_SYNTHESIS_FAILURE = r"name='([^']+)'"`, used by `prepare_for_aer` when `_find_unsupported` finds nothing.
What: any transpile exception whose text contains `name='…'` (for example a register or parameter repr, or a target or layout error) is re-raised as `UnsupportedInstructionError('<that name>')`. The user is then told "The simulator cannot run the instruction 'q'" for a failure that has nothing to do with an instruction. `_find_unsupported` can likewise blame the first non-basis op that has no definition even when the transpile failed for a different reason.
Why it matters: `unsupported_instruction` is a typed wire code (§4.2) that the frontend acts on, and misclassifying an error is worse than passing the original through.
Fix: only accept the regex culprit when it names an instruction that is actually in the circuit (`{op.name for op in _walk(circuit)}`). Otherwise re-raise the original exception. Add a test with a transpile failure that is not an instruction failure.

## Minor

- **M1** `kernel/adapters/_qiskit_aer.py:89-97` `run_on_aer` wraps only `.result()`. When Aer reports a failed result instead of raising, the later `.get_statevector()` / `.get_counts()` raises a `QiskitError` ("No counts for experiment") outside the wrapper. No test covers this branch, because `test_unsupported_instruction_names_the_gate` is satisfied by the transpile path. Fix: check `result.success`/`status` inside `run_on_aer`, and add a test that monkeypatches `backend.run`.
- **M2** `kernel/adapters/_qiskit_expand.py:65-72` `expand_blocks` does not guard `compose()`. An expansion failure makes `extract_snapshot(expand_blocks=True)` raise, which contradicts its "Total: no instruction can make it raise" docstring. Fix: catch the error, return the unexpanded circuit plus a note.
- **M3** `kernel/adapters/binding.py:88` validates values for names the circuit does not have. A stale non-numeric entry raises `ValueError` even though the docstring says unknown names are ignored. Fix: filter to `names` before `_finite_number`. Also, `free_parameter_names`/`_apply` (`:37`, `:117`) treat every non-Qiskit object as Cirq. A Q# or CUDA-Q object would import cirq and silently report no parameters. Raise `TypeError` for unknown circuit types instead. Bad-input `ValueError`s have no `code`, so R-B cannot tell them apart from simulation failures. Consider an `invalid_request`-coded subclass.
- **M4** `kernel/adapters/qiskit_adapter.py:176-183` transpiles twice on every measured run (once for the state vector, once for the counts), even when the circuit is already in Aer's basis. The Run overhead budget (≤ 300 ms) has no perf test in this unit, so the cost is unmeasured. Consider transpiling once and deriving the state-vector circuit from the prepared one, or skipping transpile when `_find_unsupported` is clean and no op needs synthesis.
- **M5** `kernel/tests/test_adapters_research_paths.py:32` ignores every `DeprecationWarning`/`PendingDeprecationWarning` for the whole module. That also hides deprecations raised by the code under test (`transpile`, `remove_final_measurements`, Aer). Narrow the filter to the library-class and `Instruction.condition` messages.
- **M6** `kernel/models/snapshot.py:41` `CircuitSnapshot.notes` is a new `snapshot` wire field that §4.2 does not list, and `src/types` and the docs do not describe it. Record it in the protocol changelog together with I1's docs work.
- **M7** `kernel/tests/test_adapters_research_paths.py:346` the test is named `test_cirq_circuit_operation_and_matrix_gates_simulate` but uses no `CircuitOperation`. Rename it or add one.
- **M8** `kernel/adapters/qiskit_adapter.py:95` `_expand` exists only so a test can monkeypatch `MAX_EXPANDED_GATES`. Pass `max_gates` as a parameter of `extract_snapshot` (internal) instead of an indirection.
- **M9** `kernel/models/snapshot.py:4-9` keeps `UNBOUND_PARAMETERS_MESSAGE` as dead code solely for a test that I1's patch rewrites. Remove both together once I1 lands.
- **M10** The corpus goldens in `r_a/expected.yaml` pin counts (`measured: 0`) but not `measurements_source` or `probabilities_exact`. If the R-D facts schema allows those keys, pin them, at least `probabilities_exact: false` for `ra-qiskit-unitary-if-test`.

## Report verification

- RED evidence is present (`ModuleNotFoundError: kernel.adapters.binding`, then the Cirq `Circuit has no measurements to sample` RED). GREEN: 75 tests on dev, qk2, minimal, full and app-env.
- Corpus: full/min/qk2 each reported `80 passed, 2 skipped, 15 xfailed`, zero unexpected. I did not re-run it. The report does not explain the 2 skips.
- Full kernel suite: 6 failures caused by this change (I1) are disclosed, plus 1 Qiskit-2 failure the report says already exists at base. I did not re-verify that claim.
- The claim that the new exception attributes do not collide with `Executor._capability_error`'s `getattr(exc, "name")` missing-dependency sniff checks out: the errors use `.parameters`/`.instruction`, not `.name`.

## Cannot verify from the diff

- R-13 "snapshot failure still allows Run" end to end: `executor.py:493-495` still returns `adapter_error` and skips `simulate` when `extract_snapshot` raises. Fixing that is R-B's wiring of `try_extract_snapshot`.
- R-4 end to end (`parameter_values` on `execute`, `bound_at` in the result, `unbound_parameters` error frame with `severity: "info"`): R-B.
- Latency budgets (parse p50 ≤ 150 ms, Run overhead ≤ 300 ms) with transpile on every run: no perf test in this unit.
- The corpus counts and the Qiskit 2.x results reported for the qk2/app-env venvs (not re-run).
