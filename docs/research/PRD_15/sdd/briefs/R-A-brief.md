# Brief — PRD 15 unit R-A

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **R-A Adapters** (Wave 0b) | R-1 no-measure circuits return statevector + exact probabilities, `measurements = {}`, `measurements_source: "none"`, `probabilities_exact: true` (never silent `measure_all`); R-2 `transpile(circuit, backend, optimization_level=0)` / bounded decompose before Aer, `unsupported_instruction` names the gate, opt-in snapshot block expansion; R-4 kernel side: `kernel/adapters/binding.py: bind_parameters(circuit, parameter_values | random_seed) -> (circuit, bound_at)` and the `unbound_parameters` info code (R-B wires it into the execute path); R-13 total adapter (`<complex[2]>`, `<unitary 4x4>`, `<block>` labels, snapshot failure degrades to "snapshot unavailable") | `kernel/adapters/**` (incl. new `binding.py`), `kernel/models/snapshot.py`, `kernel/tests/test_adapters_research_paths.py`, `kernel/tests/research_corpus/r_a/**` | `test_execute_no_measurements_{qiskit,cirq}`; parametrized library-gate test (`QFT, EfficientSU2, TwoLocal, RealAmplitudes, ZZFeatureMap, PauliEvolutionGate, iswap, rzz, rxx, cswap`); `parameter_values` bound/unbound; snapshot of `initialize/unitary/if_test` |
| **R-A** Adapters | no-measure results, library gates, `adapters/binding.py`, total adapter | §5.1 |

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


### 4.2 Execute path (Track R; phases `parse` / `execute`)

| Request | Response | Notes |
|---|---|---|
| `parse {run_id, code, language?, project_root?, file_path?}` | `snapshot` (+ `qec_snapshot`) or `error` | superseded parses are dropped (`parse_superseded` is never sent to a stale request; the newest wins); cached by code hash in the loaded-circuit cache shared with inspect/lint/symmetry_detect/deploy_inspect |
| `execute {run_id, code, language?, params?, seed?, parameter_values?: {name: number} \| {"random_seed": int}, project_root?, file_path?}` | `result` gains `measurements_source: "sampled" \| "sampled_from_statevector" \| "none"`, `probabilities_exact: bool`, `bound_at?: {name: value}`, `truncated?: {state_vector: bool, probabilities: bool, reason}`, `figures?: [{png_base64, title}]`, `metrics`, `seed_honored`. R-1 (no measurements): `measurements = {}`, `measurements_source: "none"`, exact probabilities present (`probabilities_exact: true`) | R-1, R-4, R-11, R-12 |
| `run_cancel {run_id}` | `run_cancelled {run_id, accepted}` then the pending `error {code: "cancelled"}` | R-6; kills that run's worker; a cancel for a finished or unknown `run_id` is ignored (`accepted: false`) so Stop clicked as a run finishes never kills the next run |
| `lint` | `lint_result` gains `available: bool, reason?` | R-16 |
| new error codes | `unbound_parameters` (info-class, carries `parameters`), `too_many_qubits` (with the memory estimate and the `method=matrix_product_state` re-run action), `timeout`, `user_exit`, `worker_died`, `too_much_memory`, `unsupported_instruction` (names the gate), `output_truncated` note on `output` frames | R-4, R-11, R-6, R-7, R-2, R-22 |


## Audit items you close (docs/research/PRD_15/00_RELIABILITY_AUDIT.md)

### R-1 (High) Circuits with no measurements cannot be run (Qiskit and Cirq); sweeps lose their metrics
- Symptom: Run prints `QiskitError: 'No counts for experiment "0"'` (Qiskit) or `ValueError: Circuit has no measurements to sample.` (Cirq). The statevector, Bloch spheres and histogram never appear. `record_metric(...)` values are discarded because the whole `result` is `null` on any error.
- Repro (all three envs): `q02-bell-NO-measure`, `q05-param-bound-nomeasure`, `q14-Statevector-only`, `q15-Estimator-V2-energy`, `q36-experiment-no-measure-metrics` (with `params`/`seed`), `c02-bell-NO-measure`, `c08-user-simulate-print`, `c14-cirq-pauli-sum-expectation`. Minimal: `qc = QuantumCircuit(2); qc.h(0); qc.cx(0,1)`.
- Evidence: `sum_*.txt`; `q36` returns `error`, `metrics=None` while the same program with a measurement returns `metrics={'theta_used':1.1}, seed_honored=True`. Bell-without-measure is also what a statevector/expectation program (VQE, kernels, surrogates) naturally looks like.
- Root cause: `kernel/adapters/qiskit_adapter.py:156-157` (`sim_qasm.run(circuit_obj, shots).result().get_counts()` raises when the circuit has no measure) and `kernel/adapters/cirq_adapter.py:169` (`sim.run(circuit_obj, repetitions=shots)` raises). The statevector half (`qiskit_adapter.py:141-146`, Cirq `:149-166`) already succeeded before the failure.
- Fix: detect "no measurement ops" (Qiskit: no `measure` instruction; Cirq: `not any(cirq.is_measurement(op) ...)`). Return the statevector, probabilities and Bloch data and set `measurements = {}` plus an explicit `sampled: false` / `note` field; optionally sample from the exact probabilities with the requested seed, labelled `source: "statevector"` so nothing is passed off as hardware-style shots. The histogram panel needs an honest "no measurements in this circuit; showing exact probabilities" state. Never auto-add `measure_all` silently.
- Regression tests: kernel `test_execute_no_measurements_{qiskit,cirq}` asserting `error is None`, `probabilities` present, `measurements == {}` or labelled; a record_metric sweep point over a no-measure circuit; vitest for the histogram empty-sample state; add `q02/q14/c02/c08/q36` to the corpus golden (section 6).


### R-2 (High) Composite/library gates cannot be simulated; the diagram shows one opaque box
- Symptom: `AerError: 'unknown instruction: QFT'` (also `IQFT`, `EfficientSU2`, `TwoLocal`, `RealAmplitudes`, `ZZFeatureMap`, `PauliEvolution`, `iswap`). The circuit diagram shows a single `QFT`/`EFFICIENTSU2` box with no gate-level structure.
- Repro (owner, min, dev identical): `q06-QFT-append-measure`, `q07-QFT-inverse-NO-measure`, `q27-PauliEvolution-trotter`, `q28-gate-zoo-snapshot` (`iswap`); with detection worked around (`libvar.py`): `q09`, `q11`, `q12`, `q13` all end `unknown instruction: <name>`, and `q08` (manually `.decompose(reps=2)`) passes.
- Evidence: the `transpile` message succeeds on the same QFT circuit (`misc.py`, `transpile-QFT -> transpile_result`), so the decomposition machinery exists; the Run path just does not use it.
- Root cause: `qiskit_adapter.py:142-143` and `:155-156` call `AerSimulator.run(circuit)` on the user's circuit without `transpile(circuit, backend)` (Aer only accepts its basis). `extract_snapshot` (`:60-100`) maps by `type(op).__name__`, so composite blocks stay one gate.
- Fix: `transpile(circuit, backend, optimization_level=0)` (or `circuit.decompose()` until Aer-native) before both Aer runs; keep the original circuit for the snapshot but add an opt-in "expand blocks" (decompose one level) so the diagram can show gate structure; cap expansion size. Fall back with a clear `unsupported_instruction` error naming the gate, not an AerError.
- Regression tests: parametrized kernel test over `QFT, EfficientSU2, TwoLocal, RealAmplitudes, ZZFeatureMap, PauliEvolutionGate, iswap, rzz, rxx, cswap` asserting a result; snapshot test that a composite block expands when requested.


### R-4 (High) Run on a parameterized circuit fails, and the message sends the user to another panel
- Symptom: `ValueError: bind circuit parameters before simulating (Trainability Lab analyzes free parameters)`. The shipped Lab fixtures `ansatz/hardware_efficient.py` and `tfim_hva.py` fail on plain Cmd+Enter with this error, as does any `ParameterVector`/`sympy` ansatz.
- Repro: `q04-param-unbound-ansatz`, `q10-EfficientSU2-unbound`, `c03-param-sympy-unresolved`; `run_lab.py` (`plain-execute ... ERR simulation_error`).
- Root cause: `qiskit_adapter.py:127-128`, `cirq_adapter.py:136-137` raise `UNBOUND_PARAMETERS_MESSAGE` and `server.py` classifies it as `simulation_error`. There is no way to supply values on the Run path (experiments inject `params`, but the circuit has `Parameter` objects, not `params["theta"]`).
- Fix: unbound parameters are not an error for the editor: keep the snapshot, show "N free parameters; nothing to simulate" as an info state with a "Run at point..." affordance (zeros, a user-set point, or seeded random), and have the kernel accept `parameter_values` (name -> float, or `random_seed`) on `execute`, reporting `bound_at` in the result. Do not word a core run error around another panel.
- Regression tests: execute with `parameter_values`; execute without them returns an `info`/`unbound_parameters` code distinct from `simulation_error`; Playwright (real kernel) running the lab fixture.


### R-13 (Med) Adapter TypeErrors for `initialize`, `unitary`, `if_test` (no snapshot at all)
- Symptom: `adapter_error: TypeError: float() argument must be a string or a real number, not 'complex'` (`initialize`), `only 0-dimensional arrays can be converted to Python scalars` (`unitary`), `... not 'QuantumCircuit'` (`if_test` block param). The whole snapshot is lost, so the diagram is blank.
- Repro: `q25-initialize`, `q26-unitary-gate`, `q20-if_test-dynamic` (all envs).
- Root cause: `qiskit_adapter.py:52` `params.append(float(p))` on non-real params.
- Fix: non-real/array/circuit params -> emit `0.0` with a descriptive symbol label (`"<complex[2]>"`, `"<unitary 4x4>"`, `"<block>"`) rather than raising; unit-test each. Keep the adapter total: a snapshot failure must degrade to "snapshot unavailable" and still allow Run.
- Regression tests: snapshot of each special instruction.


## Controller rulings for this unit (binding)
- R-B runs in parallel and owns kernel/executor.py, kernel/server.py, run_worker.py: you deliver the adapter-side behaviour + kernel/adapters/binding.py; R-B wires parameter_values into the execute path. Keep adapter public signatures backward compatible.
- Add your corpus programs under kernel/tests/research_corpus/r_a/** and flip the R-1/R-2/R-13 xfail(strict) entries R-D created (if they live in R-D`s scout expected.yaml, that file is now yours to edit for those R-ids only).
- Must work on Qiskit 1.x (dev .venv) AND Qiskit 2.x (create a py3.13 + qiskit>=2,<3 venv with uv, or use scripts/make-test-venvs.sh from R-D) - run your tests in both.
- Corpus flips (supersedes any earlier wording about editing scout/expected.yaml): flip the scout/gates xfail(strict) entries for the R-ids you close through YOUR OWN kernel/tests/research_corpus/<unit>/overrides.yaml (supported by R-D's loader; see kernel/tests/research_corpus/README.md). Never edit scout/ or gates/ files.
- Wire shape ruling: `unbound_parameters` is sent as an error frame {type:"error", phase, code:"unbound_parameters", severity:"info", parameters:[names...], message} — info-class means the frontend renders it as a prompt (R-G), not a red error; the corpus classifier sees it as error:unbound_parameters.
- Run the research corpus in the full and minimal envs before reporting: NUCLEI_CORPUS_ENV=full $(scripts/make-test-venvs.sh path full) -m pytest kernel/tests/test_research_corpus.py -q (and NUCLEI_CORPUS_ENV=min with the minimal venv). Zero unexpected statuses.
