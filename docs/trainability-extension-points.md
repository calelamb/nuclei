# Trainability Lab — architecture & extension points (verified at HEAD 5de9a0e0, branch quantum-ai-ml)

Status correction: QML is no longer uncommitted. HEAD `5de9a0e0 Add quantum ML to Trainability Lab…`
committed qml_{train,kernel,data}.py, noise.py, QML tabs and tests. `git status --short` shows only
untracked `SHARED_QML_NOTES.md` and `docs/quantum-ml-extensions-spec.md` (do not edit those).
`docs/trainability-architecture-map.md` (committed in the same commit) describes the pre-QML tree
(6 analyses, tandem-modified files) and is stale where it differs from this file (now 8 analyses).

## Kernel flow (protocol)

- `kernel/trainability/handlers.py:161-184` `handle/_dispatch`: `trainability_inspect|lint|start|cancel`,
  else `unknown_message` error envelope `{type:error,phase:trainability,code,message[,job_id,column]}`.
  Inspect/lint run sync off-loop (`asyncio.to_thread`, `handlers.py:89-109`; lint via importlib `kernel.trainability.lint`).
- `handlers.py:129-139` `_build_request`: `_code/_language/_params/_optional_observable/_job_id` +
  `normalize_analyses(msg.analyses)` + `normalize_settings(msg.settings)` (`_settings.py`) -> `jobs.get_manager().start(ctx,req)`.
- `kernel/trainability/jobs.py:51-92` `TrainabilityJobManager(LabJobManager in kernel/lab_proc.py)` spawns
  `python -I -c` bootstrap -> `job_worker.main`; limits per-owner 2 / global 4 / wall 20 min (`jobs.py:31-34`).
  `_spec = {code,language,params,observable,analyses,settings}`.
- `jobs.py:98-140` worker events `prepared/progress(throttled 0.1s)/partial/analysis_error/fatal/done` ->
  wire `trainability_started/progress/partial` + terminal `trainability_result{status:complete|failed|cancelled,
  results{},errors{},elapsed_ms,provenance=build_provenance}`. Results/errors are analysis-name-keyed dicts.
- `kernel/trainability/job_worker.py:245-266` `prepare(spec)`: `_usercode.load_circuit + resolve_observable + get_backend`
  -> `JobData{circuit:ParamCircuit, observable_sum:PauliSum, settings, loaded, …}` (`job_worker.py:56-68`).
- `job_worker.py:269-296` `run_job`: emit `prepared{n_qubits,n_parameters,observable,backend}`; for each analysis in
  `spec.analyses` call `run_analysis(job,a,progress,cancel=lambda:False)`; per-analysis exception isolated to
  `analysis_error`, success to `partial{analysis,result}` (JSON via `_jsonable.to_jsonable` in `_claim_stdout`, 299-314).

## Registry / dispatch (the extension seam)

There is no decorator or single registry table. Three places must agree:

1. `kernel/trainability/_settings.py:10` `ANALYSES = (gradients, scaling, lie, expressibility, entanglement,
   landscape, quantum_kernel, variational_train)` — canonical order = run order.
   `normalize_analyses` (`_settings.py:234-244`): non-empty list, unknown -> `unknown_analysis`, dedup in canonical order.
2. `job_worker.py:139-214` `_dispatch_analysis` if-chain (else `TrainabilityError(unknown_analysis)`):
   - `_EXTERNAL` (`job_worker.py:48-52`) only for gradients->`analyses.gradient_statistics`,
     scaling->`scaling.scaling_study`, lie->`lie.lie_algebra`, resolved by `_external()` (71-80) with test seam
     `OVERRIDE_ENV=NUCLEI_TRAINABILITY_ANALYSES_MODULE`, invoked via `call_filtered` (83-91, signature-filtered kwargs).
   - Inline imports for the other five: expressibility->`expressibility.expressibility`, entanglement->
     `expressibility.entangling_capability`, landscape->`landscape.landscape`, quantum_kernel->`qml_kernel.quantum_kernel`,
     variational_train->`qml_train.variational_train`, each passing its settings section explicitly.
3. `job_worker.py:94-113` `_check_width` + `_NEEDS_PARAMETERS=(gradients,landscape)` (line 53; QML pair rechecked at 112-113):
   gradients <=128 PPE (`MAX_PPE_QUBITS`) / sampling <=20; expressibility, entanglement, landscape,
   quantum_kernel, variational_train <= `MAX_STATEVECTOR_QUBITS=20`.
   Plus `job_worker.py:217,220-242` `_NOISE_AWARE=(gradients,quantum_kernel,variational_train)` in `run_analysis`:
   non-aware analyses get a `channel_noise` echo + "ignored" note instead of silent drop.

Settings: `_settings.py:153-232` `normalize_settings` always returns the full clamped dict: top-level
`samples/seed/init/method/backend` + sections `scaling{qubits,layers,qubit_param,layer_param}`,
`expressibility{pairs,bins}`, `entanglement{samples}`, `landscape{resolution,span}`, `lie{max_dimension,time_budget_s}`,
`qml{dataset,samples,noise,train_fraction}`, `kernel{ridge_lambda}`,
`variational{epochs,learning_rate,data_params,optimizer,gradient_method,early_stop_patience,spsa_a,spsa_c}`,
`noise{shots,depolarizing_p,readout_flip_p}` via `_int/_float/_choice/_section/_int_list/_identifier(_list)` (`_settings.py:63-123`).

## Core types / compiler / backends

- `kernel/trainability/ir.py:63-147`: `ParamRef{name,coeff,offset}` (angle = coeff*value+offset),
  `IrGate{name,qubits,angles,source_index,source_line}`, `ParamCircuit{n_qubits,gates,parameters[],framework,notes}`
  with strict `to_json/from_json` (IrError), `param_index()`, `bind_vector(values)`. `MAX_IR_QUBITS=256` (ir.py:38).
- `kernel/trainability/compiler.py:290-304` `compile_circuit(circuit,backend='auto')->KernelProgram` (LRU cache by IR hash+backend;
  pipeline canonicalize+merge_rotations+fuse_fixed_1q+lower_items in `_build`, 255-287; `MAX_STATEVECTOR_QUBITS=20`, line 52).
  `KernelProgram` (63ff): `states(values(B,m),initial)->(B,2^n)` (160), `expectations(values,PauliSum)->(B,)` (175),
  `value_and_grad(values,obs)->((B,),(B,m))` batched adjoint (187), and `value_and_grad_costate(values,costate_fn(psi)->(value,lam))`
  (198-213) — the hook for custom objectives/model losses without new IR. Memory chunking via `chunk_size` (110).
- `kernel/trainability/backends.py:49-141`: `Backend{name:numpy|cupy|jax, xp, jit, chunk_bytes, basis_zero/asarray/to_numpy/add_at_cols}`;
  `get_backend('auto')` prefers cupy, then GPU jax, else numpy; `available_backends()`; kernels `apply_1q/apply_dense/apply_mono` (147ff).
  New backend = `_load_*` + `get_backend/available_backends` + `_settings.BACKENDS` (line 13) + TS `TrainabilityBackendChoice`.
- `kernel/trainability/statevector.py:38-92`: unbatched B=1 wrappers over `compile_circuit` — `simulate/expectation/value_and_grad`,
  plus `parameter_shift_grad` (2-term, 4-term for controlled rotations via `gates.SHIFT_4TERM_GATES`, reference oracle).
- Analysis contract `kernel/trainability/_analysis_common.py:1-50`: `fn(circuit[,observable],*,<cfg>,seed,backend,progress(frac,msg),cancel()->bool)->dict`
  JSON-able, deterministic given seed except `elapsed_ms`; `AnalysisError(code,msg)`, `check_cancel/report`.
  Gotcha: two cancel exception types exist — `_analysis_common.AnalysisCancelled` (analyses, scaling, lie, qml_*) vs
  `_errors.Cancelled` (landscape.py:10, expressibility.py:14 import `check_cancel/report` from `_errors`).
  `run_job` catches only `_errors.Cancelled` (job_worker.py:35,289) and passes `cancel=lambda:False`, so neither fires in production;
  an `_analysis_common` cancel would surface as a per-analysis error. `_errors.normalize_error` (31-45) maps IrError/AnalysisError->TrainabilityError.

## Committed analyses (signatures -> output shape)

- `analyses.py:268-342` `gradient_statistics(circuit,observable,*,samples,seed,init=uniform|small,method=auto|sampling|ppe,backend,channel_noise)`:
  sampling via `KernelProgram.value_and_grad` + percentile bootstrap, or exact PPE `pauliprop.ppe_gradient_variances` with truncation interval;
  auto = PPE if interval tight (<=10%, `TIGHT_FRACTION`) else sampling with `fallback_reason`. Out: `{per_parameter[],variance_mean{,_ci95},
  cost_{mean,variance},gate_values[{source_index,parameter,variance,abs_mean}],method,interval{kind},notes,seed,elapsed_ms}`.
  NOTE: `analyses.py` is only this one analysis — it is not the registry (see above).
- `scaling.py:299-334` `scaling_study(builder(nq,nl)->ParamCircuit,*,qubits,layers,observable_spec,…)` reuses `gradient_statistics`
  per (n,l) point + exponential/power fits (`fit_scaling`). Builder/spec built in job_worker (`_scaling_builder/_scaling_observable_spec`, 116-136).
- `lie.py:325-380` `lie_algebra(circuit,*,observable,max_dimension,time_budget_s,cancel)` (cores `lie_core/_lie_dense/_circuit_walk`):
  `{status,dimension,classification,purity,predicted_variance(prediction_quantity=cost_variance),simulability,…}`.
  No `progress/backend/seed` kwargs — `call_filtered` drops them, which is why that helper exists.
- `expressibility.py:85-136` `expressibility(circuit,*,pairs,bins,seed,backend)` KL of fidelity distribution vs Haar via `program.states`;
  `expressibility.py:153-194` `entangling_capability(circuit,*,samples,seed,backend)` Meyer-Wallach Q distribution vs Haar mean.
- `landscape.py:48-100` `landscape(circuit,observable,*,resolution,span,seed,center='random',backend)`: two random orthonormal
  directions, `program.expectations` grid -> `{axis,values[][],center,min,max,center_value,elapsed_ms}`. Smallest complete template to copy.
- QML (committed template for a model type): `qml_kernel.py:74 quantum_kernel(circuit,*,dataset,…,ridge_lambda,channel_noise)` and
  `qml_train.py:76 variational_train(circuit,observable,*,dataset,…,epochs,optimizer,gradient_method,data_params,…)` over
  `qml_data.py:105 load_dataset` (moons/circles/blobs/xor) and `noise.py:63 NoiseSpec`.

## UI / protocol mirror

- `src/types/trainability.ts:10-29` `TrainabilityAnalysis` union + `TRAINABILITY_ANALYSES[]` (must match `_settings.ANALYSES`);
  `:64-93` `TrainabilitySettings` (all sections optional); result interfaces `GradientStatistics/ScalingStudy/LieAlgebraResult/
  ExpressibilityResult/EntanglingCapabilityResult/LandscapeResult/QuantumKernelResult:260/VariationalTrainResult:286`;
  `:320-329` `TrainabilityResults{<analysis>?:…}`; `:387-442` request/response unions
  (`trainability_start{job_id,code,observable,analyses,settings}` / `started|progress|partial|result|cancelled`);
  `:446` `TrainabilityTabId = gradients|scaling|lie|expressibility|landscape|kernel|training`
  (tab ids need not equal analysis names: kernel->quantum_kernel, training->variational_train, expressibility tab hosts entanglement too).
- `src/services/trainability/client.ts:172ff` `createTrainabilityClient(session)->{inspect,lint,start(input,onEvent)->JobHandle{done,cancel}}`:
  generic over analysis name/result — no per-analysis code.
- `src/services/trainability/settings.ts:36-82` `TargetSettings`+defaults (flat UI fields); `:176-185`
  `availableAnalyses(inspection)` = all minus scaling unless `sweepable_params` includes `n_qubits`;
  `defaultAnalyses` additionally excludes the opt-in QML pair; `:187-238` `toKernelSettings(settings,analyses,inspection)`
  emits sections only for selected analyses (kernel fills defaults for the rest). `NOISE_AWARE_ANALYSES` mirrors kernel (line 34).
- `src/stores/trainabilityStore.ts` (zustand): `settings, analysesOverride|null, activeTab, jobs`;
  `start()` 384-452: `effectiveAnalyses()` (536-541) = override ?? defaults, intersect available; scaling + no-parameters guards;
  `toKernelSettings`; `client.start`. Reducers generic: `applyEvent` partial -> `results:{...job.results,[analysis]:result}` (168-186),
  `applyEnd` merges final result (188ff). No per-analysis store logic.
- `src/components/trainability/AnalysisTabs.tsx:15-23` `TAB_ITEMS[{id,label,icon}]` + `LabSegmented`; per tab (38-77):
  `<AnalysisPanel view={analysisView(job,'<analysis>')} title emptyBody>{data=><XTab data/>}</AnalysisPanel>` inside
  `LabErrorBoundary resetKeys=[activeTab,job.id,job.results]`. `analysisState.ts:12-33` `analysisView` is fully generic:
  empty|skipped|loading{fraction,message}|cancelled|error{code,message}|ready{data:TrainabilityResults[K]}`.
  Tabs live in `src/components/trainability/tabs/{Gradients,Scaling,Lie,Distributions,Landscape,QmlKernel,VariationalTrain}Tab.tsx`, each `{data}`-typed.
  `TargetBar.tsx:39-47` `ANALYSIS_LABELS: Record<TrainabilityAnalysis,string>` (exhaustive — compile error until a new analysis is labelled)
  plus per-analysis settings controls (252ff). Optional consumers: `services/trainability/{verdict,certificate}.ts` (certificate reads QML results at 245,257), `fixtures.ts`, `fakeSession.ts`.

## Add a NEW analysis end-to-end (exact edits)

Worked example to imitate: `git show 5de9a0e0` (quantum_kernel + variational_train, 27 files).

1. NEW `kernel/trainability/<mod>.py`: `fn(circuit, observable?, *, <cfg>, seed, backend, progress, cancel) -> dict`.
   Use `compile_circuit`/`statevector`, `np.random.default_rng(seed)`, `check_cancel/report`, `AnalysisError` codes;
   return JSON-able dict + `elapsed_ms`. Copy `landscape.py` (100 lines) or `expressibility.py` structure.
2. `kernel/trainability/_settings.py`: append name to `ANALYSES` (line 10; position = execution order) and add a
   `normalize_settings` section with `_section/_int/_float/_choice` defaults+clamps (153-232).
3. `kernel/trainability/job_worker.py`: add branch in `_dispatch_analysis` (139-214) — either `_EXTERNAL` entry +
   `call_filtered` (only if you want the `NUCLEI_TRAINABILITY_ANALYSES_MODULE` override seam) or inline import passing
   `s['<section>']` like quantum_kernel (187-196). Add width cap in `_check_width` (105 list if statevector-bound),
   `_NEEDS_PARAMETERS`/no-params check if applicable, and `_NOISE_AWARE` (217) only if it actually consumes `channel_noise=s.get('noise')`.
4. No change needed: `handlers.py`, `jobs.py`, `client.ts`, store reducers, `analysisState.ts` — all name-keyed/generic.
5. `src/types/trainability.ts`: add to `TrainabilityAnalysis` + `TRAINABILITY_ANALYSES` (10-29), settings section (64-93),
   result interface, `TrainabilityResults{<name>?:…}` (320-329), and `TrainabilityTabId` (446) if it gets its own tab.
6. `src/services/trainability/settings.ts`: `TargetSettings` fields + defaults + `toKernelSettings` section (only if UI-exposed;
   otherwise kernel defaults apply); gate in `availableAnalyses` (176-179) if it has preconditions; exclude from
   `defaultAnalyses` (181-185) if opt-in like QML.
7. NEW `src/components/trainability/tabs/<Name>Tab.tsx` (`{data: <Result>}`); register in `AnalysisTabs.tsx`
   (`TAB_ITEMS` 15-23 + `AnalysisPanel` block 38-77, or as a second panel in an existing tab like entanglement).
   Add label to `TargetBar.tsx` `ANALYSIS_LABELS` (39-47, exhaustive Record) + controls there if settings are UI-exposed.
   Optional: `verdict.ts`/`certificate.ts`/`fixtures.ts`.
8. Tests: NEW `kernel/tests/test_trainability_<name>.py` (direct fn call + `run_analysis`/`normalize_settings` path;
   run `cd kernel && ~/.cache/nuclei-test-venvs/full/bin/python -m pytest`), tab/settings tests beside
   `src/components/trainability/*.test.tsx` and `src/services/trainability/*.test.ts` (see `qmlTabs.test.tsx`, `qmlSettings.test.ts`).

## Add a NEW model type (not just an analysis)

- Custom loss/objective on existing circuits: no IR change — use `KernelProgram.value_and_grad_costate`
  (`compiler.py:198-213`) or `value_and_grad` over `ParamCircuit`, exactly the QML path (`qml_train.py`), then steps 1-8 above.
- New circuit semantics/gate: `ir.py` (only if the IR shape changes) + `convert.py:134,263,302` (`from_qiskit/from_cirq/from_object`)
  + `gates.py:170-221` (`GateSpec` table: matrix + Pauli generator) + `passes.py:65ff` canonicalize and `lowering.py:173 lower_items`;
  validate against `statevector.parameter_shift_grad` / `reference.py` oracle. New backend: see backends note above.
