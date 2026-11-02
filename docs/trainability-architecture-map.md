# Trainability Lab — committed architecture & extension points (HEAD, worktree quantum-ai-ml)
Tandem-modified (DO NOT EDIT): kernel/trainability/{_settings,analyses,job_worker}.py,
src/{types/trainability.ts,stores/trainabilityStore.ts,services/trainability/{settings,certificate}.ts,
components/trainability/{AnalysisTabs,TargetBar}.tsx,tabs/GradientsTab.tsx}; untracked QML: qml_*.py,noise.py,Qml*Tab,VariationalTrainTab,tests. Below = `git show HEAD:` where modified.

## Kernel flow
server.py -> handlers.handle(msg,ctx) [kernel/trainability/handlers.py: _dispatch]
  trainability_inspect/lint -> asyncio.to_thread(_inspect_sync/_lint_sync) (inspect.py:inspect_code, lint.py via importlib)
  trainability_start -> _build_request: _code/_language/_params/_optional_observable/_job_id +
    normalize_analyses(msg.analyses)+normalize_settings(msg.settings) [_settings.py] -> jobs.get_manager().start(ctx,req)
  trainability_cancel -> manager.cancel(owner,job_id); unknown -> error envelope {type:error,phase:trainability,code,message[,job_id,column]}
jobs.py: TrainabilityJobManager(LabJobManager in kernel/lab_proc.py) spawns `python -I -c bootstrap job_worker.main`
  per-owner 2/global 4, wall 20min; _spec={code,language,params,observable,analyses,settings}; events prepared/progress(throttled 0.1s)/partial/analysis_error/fatal/done
  -> trainability_started/progress/partial + terminal trainability_result{status:complete|failed|cancelled,results{},errors{},elapsed_ms,provenance(build_provenance)}
job_worker.py: prepare(spec)=load_circuit+resolve_observable (_usercode.py)+get_backend -> JobData{circuit:ParamCircuit,observable_sum:PauliSum,settings,...}
  run_job: emit prepared{n_qubits,n_parameters,observable,backend}; for a in spec.analyses: run_analysis(job,a,progress,cancel=False) isolated per-analysis error -> partial{a,result:to_jsonable}
  run_analysis dispatch (THE registry, no decorator/table for 3 of 6):
    _EXTERNAL={gradients:(analyses,gradient_statistics),scaling:(scaling,scaling_study),lie:(lie,lie_algebra)} via _external()+call_filtered (signature-filtered kwargs; OVERRIDE_ENV=NUCLEI_TRAINABILITY_ANALYSES_MODULE test seam)
    inline imports: expressibility->expressibility.expressibility, entanglement->expressibility.entangling_capability, landscape->landscape.landscape; else TrainabilityError(unknown_analysis)
    _check_width: gradients <=128 PPE / sampling <=MAX_STATEVECTOR_QUBITS(20); expressibility|entanglement|landscape <=20; _NEEDS_PARAMETERS=(gradients,landscape)

## Core types/compiler
ir.py: ParamRef{name,coeff,offset} angle=coeff*value+offset; IrGate{name,qubits,angles,source_index,source_line}; ParamCircuit{n_qubits,gates,parameters[],framework,notes} to/from_json(strict,IrError), param_index(), bind_vector(values)
compiler.py: compile_circuit(circuit,backend=auto)->KernelProgram (cached; canonicalize+merge_rotations+lowering; MAX_STATEVECTOR_QUBITS=20)
  KernelProgram: states(values(B,m),initial)->(B,2^n); expectations(values,PauliSum)->(B,); value_and_grad(values,obs)->((B,),(B,m)) batched adjoint; value_and_grad_costate(values,costate_fn(psi)->(value,lam)) for custom objectives (QML hook); chunk_size memory guard
backends.py: Backend{name:numpy|cupy|jax,xp,jit,chunk_bytes,basis_zero/asarray/to_numpy/add_at_cols}; get_backend(auto->cupy?jax?numpy), available_backends(); kernels apply_1q/apply_dense/apply_mono. New backend = _load_* + get_backend/available + _settings.BACKENDS + TS TrainabilityBackendChoice.
statevector.py: unbatched B=1 wrappers simulate/expectation/value_and_grad/parameter_shift_grad (2/4-term shift, reference oracle) over compile_circuit.
_analysis_common.py: contract for every analysis: fn(circuit[,observable],*,seed,backend,progress(frac,msg),cancel()->bool)->dict(JSON-able, elapsed_ms only nondeterminism); AnalysisError(code,msg), AnalysisCancelled, check_cancel/report.

## Analyses (committed ANALYSES=_settings.py: gradients,scaling,lie,expressibility,entanglement,landscape)
analyses.py:gradient_statistics(circuit,observable,samples,seed,init=uniform|small,method=auto|sampling|ppe,backend) -> sampling via KernelProgram.value_and_grad+bootstrap CI, or PPE pauliprop.ppe_gradient_variances truncation interval; auto=PPE if tight<=10% else sampling(fallback_reason). Out:{per_parameter[],variance_mean{,_ci95},cost_{mean,variance},gate_values[{source_index,parameter,variance,abs_mean}],method,interval{kind},notes,seed,elapsed_ms}
scaling.py:scaling_study(builder(nq,nl)->ParamCircuit,qubits,layers,observable_spec,...) reuses gradient_statistics per point + exp/power fits.
lie.py:lie_algebra(circuit,observable,max_dimension,time_budget_s,cancel) (lie_core/_lie_dense,_circuit_walk) -> {status,dimension,classification,purity,predicted_variance(cost_variance),simulability,...}; NO progress/backend kwarg (call_filtered drops).
expressibility.py: expressibility(circuit,pairs,bins,seed,backend) KL vs Haar fidelities via program.states; entangling_capability(circuit,samples,seed,backend) Meyer-Wallach.
landscape.py: landscape(circuit,observable,resolution,span,seed,center=random,backend) 2 random orthonormal dirs, program.expectations grid -> {axis,values[][],center,min,max,center_value}
_settings.py: normalize_analyses(non-empty list, dedup canonical order, unknown->unknown_analysis); normalize_settings: clamped sections samples/seed/init/method/backend + scaling{qubits,layers,qubit_param,layer_param}/expressibility{pairs,bins}/entanglement{samples}/landscape{resolution,span}/lie{max_dimension,time_budget_s} via _int/_float/_choice/_section/_int_list/_identifier.

## UI (committed)
src/types/trainability.ts (protocol v1.3 mirror): TrainabilityAnalysis union + TRAINABILITY_ANALYSES[], TrainabilitySettings{per-analysis optional sections}, result ifaces (GradientStatistics,ScalingStudy,LieAlgebraResult,ExpressibilityResult,EntanglingCapabilityResult,LandscapeResult), TrainabilityResults{gradients?:...}, msgs trainability_{inspect,lint,start,cancel} / {inspected,lint_result,started,progress,partial,result,cancelled}, TrainabilityTabId=gradients|scaling|lie|expressibility|landscape (entanglement folded into expressibility tab), TrainabilityJobRecord.
src/services/trainability/client.ts: createTrainabilityClient(session)->TrainabilityClient{inspect,lint,start(...onEvent)->JobHandle{cancel}} sends trainability_start, maps started/progress/partial/result->JobEvent. Generic over analysis name/result (no per-analysis code except types).
src/services/trainability/settings.ts: TargetSettings{samples,seed,init,method,scalingQubitsText,scalingLayersText}, availableAnalyses(inspection)=TRAINABILITY_ANALYSES minus scaling unless sweepable n_qubits, defaultAnalyses=available, toKernelSettings(settings,analyses,inspection)->TrainabilitySettings (only scaling section conditional; others use kernel defaults).
src/stores/trainabilityStore.ts (zustand): settings, analysesOverride|null, inspect/lint, activeTab, jobs; start(target): effectiveAnalyses()=override??available, validateScaling guard, toKernelSettings, client.start; reducer: partial->{results:{...job.results,[analysis]:result}}, progress/started/end generic — NO per-analysis logic except scaling/no-params guards.
src/components/trainability/AnalysisTabs.tsx: TAB_ITEMS[{id,label,icon}] + LabSegmented + per-tab <AnalysisPanel view={analysisView(job,'x')} title emptyBody>{data=><XTab data/>}</AnalysisPanel> inside LabErrorBoundary(resetKeys=[tab,job.id,job.results]).
  analysisState.ts: analysisView(job,analysis)->empty|skipped|loading{frac,msg}|cancelled|error{code,msg}|ready{data:TrainabilityResults[K]} generic. Tabs in tabs/{Gradients,Scaling,Lie,Distributions(Expressibility+Entanglement panels),Landscape}Tab.tsx each take {data:ResultIface}.
  TargetBar.tsx = analysis toggles + settings inputs; TrainabilityLab.tsx composes TargetBar+AnalysisTabs+VerdictRail; verdict/certificate in services/trainability/{verdict,certificate}.ts consume specific results.

## Add NEW analysis end-to-end (exact edits; tandem QML quantum_kernel/variational_train does exactly this in diff)
1. NEW kernel/trainability/<mod>.py: fn(circuit,observable?,*,<cfg>,seed,backend,progress,cancel)->dict; use compile_circuit/statevector, default_rng(seed), check_cancel/report, AnalysisError codes; return JSON-able + elapsed_ms (see landscape.py/expressibility.py templates).
2. _settings.py [TANDEM-MODIFIED]: add name to ANALYSES tuple (canonical order = run order) + normalize_settings section via _section/_int/_choice (defaults+clamps).
3. job_worker.py [TANDEM-MODIFIED]: add to _EXTERNAL{name:(mod,fn)} OR inline branch in run_analysis passing s[<section>]; add _check_width cap (20 if statevector) + _NEEDS_PARAMETERS if applicable.
4. (handlers.py/jobs.py/client.ts/store reducer: NO change — analyses list/settings/results are name-keyed dicts end-to-end.)
5. src/types/trainability.ts [TANDEM]: add to TrainabilityAnalysis+TRAINABILITY_ANALYSES, settings section, Result iface, TrainabilityResults{<name>?:...}, TrainabilityTabId if own tab.
6. src/services/trainability/settings.ts [TANDEM]: TargetSettings fields/defaults + toKernelSettings section (only if UI-exposed; else kernel defaults apply) + availableAnalyses gating if preconditions.
7. NEW src/components/trainability/tabs/<Name>Tab.tsx {data}; AnalysisTabs.tsx [TANDEM]: TAB_ITEMS entry + AnalysisPanel block. Optional: TargetBar controls, verdict.ts/certificate.ts, fixtures.ts.
8. Tests: kernel/tests/test_trainability_<name>.py (call fn directly + run_analysis/settings), src/.../*.test.tsx tab + settings.test.ts; run cd kernel && ~/.cache/nuclei-test-venvs/full/bin/python -m pytest.
New MODEL type (not analysis): if needs new circuit semantics -> ir.py/convert.py/gates.py/passes.py+lowering.py (new gate/op), else reuse ParamCircuit+value_and_grad_costate for custom loss (compiler.py) — QML tandem path.
