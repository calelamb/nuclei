# QML user data + hardware execution — research (2026-11-02)

## (a) Real CSV/tabular data into QML
- DO NOT add a qec_data kind: `kernel/qec_data/adapters/base.py:29,39,365`
  CanonicalPayload/CANONICAL_OUTPUT_KINDS = {syndromes,campaign_points,
  calibrations} only; `adapters/tabular.py:146-153,153ff` mapping accepts
  output_kind syndromes|calibration with QEC fields only (frozen contract).
- REUSE lower layers in a NEW `trainability/qml_userdata.py` beside qml_data:
  `adapters/tabular_sources.py:406-423` `source_rows()` — suffix dispatch
  CSV(stdlib strict)/JSONL/Parquet/Arrow-IPC(pyarrow lazy), bounded rows;
  `qec_data/source_security.py:131,149` resolve/copy_authorized_source
  (project-root capability snapshot, symlink-safe) + `base.py:161`
  compute_source_sha256 for provenance.
- No file path exists in lab protocol today: `handlers.py:131-139`
  _build_request={code,params,settings}; `_settings.py:204` qml.dataset is a
  closed _choice; `job_worker.py:191-204` passes only the name to
  quantum_kernel/variational_train. User code could open() a host path
  (_usercode.run_namespace exec, full builtins) but analyses never read a
  namespace dataset — unsupported/unreproducible. Add settings
  `qml.source={kind:builtin|project_file,path,label,features,scale}`,
  resolve inside job_worker subprocess only.
### Angle scaling done right (fix pattern for the 2pi bug class)
Bug: `qml_data.py:44-48` `(raw-lo)/span*2pi` maps col max to exactly 2pi ==
0 rotation (collision), violating its own [0,2pi) contract :11.
1. Fit scaler on TRAIN split only; store lo/span/range in result+provenance;
   apply to test with clipping (no leakage, reproducible).
2. Endpoint: `np.minimum(scaled, np.nextafter(hi, lo))` (or *(1-1e-12)) —
   half-open interval by construction, assert finite, lo<=x<hi.
3. Range by gate, not hard-coded 2pi: RX/RY on |0> distinguish only [0,pi]
   (prob sin^2(theta/2) symmetric) → default [0,pi] or [-pi/2,pi/2];
   RZ/phase after H can use [0,2pi). Schuld,Sweke,Meyer PRA 103,032430
   (arXiv:2008.08605): model = partial Fourier series, data scale s in
   exp(-i*s*x*G) multiplies accessible frequencies — too large s aliases /
   concentrates kernels, too small is near-constant. Expose `scale`
   (bandwidth), do not bake 2pi.
4. Constant column span=0 → 0/drop; robust/percentile clip for outliers;
   labels: exactly 2 unique → {0,1} sorted, else AnalysisError; enforce
   existing n_features == len(data params) (qml_dataset_mismatch).
5. Tests: endpoint rows (min/max), constant col, train-only-fit leakage,
   out-of-range test rows clipped.
Refs: arXiv:2008.08605; IBM QML data-encoding course
quantum.cloud.ibm.com/learning/en/courses/quantum-machine-learning/data-encoding;
encoding-atlas FAQ (scale to [0,pi]/[-pi/2,pi/2]).

## (b) Trained variational circuit → real hardware
- No IR exporter exists: `trainability/convert.py:134,263,302`
  from_qiskit/from_cirq/from_object are inbound only. Binding logic to
  reuse: `ir.py:134-149` ParamCircuit.bind_vector (coeff*value+offset per
  ParamRef :63-70). Trained values exist: `qml_train.py:343-344`
  initial/final_parameters {name: float}.
- Hardware API takes concrete native objects only:
  `kernel/hardware/base.py:67` submit_job(circuit_obj,backend,shots) — no
  parameter argument. `server.py:201-256` _prepare_hardware_payload execs
  user code, `server.py:139` _extract_circuit_for_provider picks
  QuantumCircuit/Cirq Circuit by provider. IBM `ibm_provider.py:106-108`:
  transpile(circuit,backend=be) → SamplerV2.run([transpiled]) — requires an
  already-bound, measured circuit; a free Parameter fails (no PUB values).
  `google_provider.py` is a stub (NotImplementedError); Cirq hardware today
  only via e.g. Quantinuum `quantinuum_provider.py:175` pytket cirq_to_tk.
- Path 1 (recommended, no exporter): re-exec original code, keep
  LoadedCircuit.source_object (_usercode.py), bind merged
  final_parameters ∪ {data params: scaled test row} on the NATIVE object —
  Qiskit `QuantumCircuit.assign_parameters({Parameter(name): v})` (native
  object retains original ParameterExpressions, so IR coeff/offset from
  convert.py:83-109 must NOT be re-applied); Cirq
  `cirq.resolve_parameters(c, {sympy.Symbol(name): v})` / ParamResolver
  (quantumai.google/cirq/simulate/params). Then transpile to backend ISA
  and submit. IBM alternative: transpile parameterized circuit once, pass
  values per point as SamplerV2/EstimatorV2 PUB (isa_circuit[, observable],
  param_values) — needs provider change; current provider is Sampler-only,
  so classifier <O> must come from measured counts (add measure_all,
  parity/expectation classically) or add EstimatorV2.
- Path 2 (new `trainability/export.py` to_qiskit/to_cirq): walk
  bind_vector output over GATE_SPECS (gates.py _build: I,H,X,Y,Z,S,SDG,T,
  TDG,SX,SXDG,CX,CY,CZ,CH,SWAP,ISWAP,CCX,CCZ,CSWAP,RX/RY/RZ,P,U,
  RXX/RYY/RZZ/RZX,CRX/CRY/CRZ,CP) — all have direct Qiskit/Cirq forms.
  Conventions: gates.py:5-21 local bit j = gate qubit j, CX=(control,
  target) matches Qiskit; Cirq use LineQubit.range(n) in IR index order
  (convert.from_cirq sorts all_qubits); U=(theta,phi,lambda), P standard.
  Verify: round-trip to_qiskit→from_qiskit IR-hash equality + unitary
  equivalence at random binds (small n).
- Batching: manager.submit_job is single-circuit (manager.py:152); per-test-
  point jobs are costly — prefer PUB parameter arrays / circuit lists in
  one sampler.run. Hardware TRAINING stays out of scope (lab needs exact
  batched value_and_grad); this is trained-parameter inference only.
Refs: IBM docs — ISA circuits + PUBs (docs.quantum.ibm.com primitives
guides; qiskit QuantumCircuit.assign_parameters API); Cirq Parameter
Sweeps quantumai.google/cirq/simulate/params.
