# QML user data + hardware execution — addendum (verified 2026-11-02)

Supplements `docs/qml-userdata-hardware-research.md` (tracked, not edited).
State correction: tandem QML is committed (`5de9a0e0`); the angle bug below
is the *current* committed behaviour, re-verified numerically here.

## (a) User CSV/tabular data

### Do not extend qec_data; reuse its two lower layers
- Frozen contract: `kernel/qec_data/adapters/base.py` `CANONICAL_OUTPUT_KINDS
  = {syndromes, campaign_points, calibrations}`, `CanonicalPayload =
  SyndromeBatch|CampaignPointBatch|CalibrationBatch`;
  `adapters/tabular.py` `_output_kind()` accepts only `syndromes|calibration`
  and `_validate_mapping()` only QEC fields (`sequence/detector_events…`,
  calibration required set). A `dataset` kind would drag in models/codecs/
  storage — disproportionate for an in-memory `(X,y)`.
- Reusable layer 1 (parsing): `adapters/tabular_sources.py`
  `source_rows(source, columns=None)` + `source_kind()`; suffixes
  `.csv .jsonl .ndjson .parquet .arrow .feather`; hard caps
  `MAX_BATCH_RECORDS=65_536`, `MAX_RECORD_BYTES=1MiB`, `MAX_CHUNK_BYTES=16MiB`,
  `MAX_SCHEMA_FIELDS=4096`; strict stdlib `csv`, lazy pyarrow. Rows arrive as
  `TabularSourceRow.values` (name,value) tuples with byte/row spans.
- Reusable layer 2 (trust): `kernel/qec_data/source_security.py`
  `CapabilitySource` (fd-backed, `open("rb")` only) and `qec_data/server.py`
  `_snapshot_source()` copy-policy (`sourcePolicy:"copy"`,
  `verify_copied_source`/`remove_copied_source` in `_import_probe/_validate/
  _preview`); `adapters/base.py compute_source_sha256()` is symlink-rejecting
  (`O_NOFOLLOW`, regular-file check) — use it for dataset provenance.
  Mirror the probe→validate→preview UX; do not route QML through the QEC
  engine server.

### New loader shape (new file only: `kernel/trainability/qml_userdata.py`)
Return exactly the dict `qml_data.load_dataset()` returns
(`name,n_samples,n_features,noise,X,y,y_signed`) so `qml_kernel.py`/
`qml_train.py` need only a dataset-source switch, plus provenance fields
(`source_sha256, feature_columns, label_column, scaler:{lo,hi,range}`).
Explicit column mapping (like `ImportMapping.fields`), never positional
guessing beyond an explicit label column:
`{path|capability, label, features:[...], scale:"[0,pi]"}`.
Validation: finite numerics only (cf. tabular `_finite_number`), exactly two
label values → sorted `{0,1}`, `n>=4` with both classes present in each split,
row/column caps well below tabular's (statevector cost is per-row).
Generalisation blockers in current code, all in `qml_data.py`:
`dataset_features()` hard-returns 2 and `DATASETS` is a closed tuple;
`split_dataset()` loops labels `(0,1)` only (fine for binary user data);
`_settings.py` `qml.dataset` is a closed `_choice(...,QML_DATASETS)` — a
`qml.source` union (`builtin` | `project_file`) must be added there, in
`handlers.py _build_request` (today `{code,params,settings}`, code ≤1MB),
and in `job_worker.py` dispatch. The existing guards then work unchanged for
any `d`: `qml_kernel` requires `len(circuit.parameters)==n_features`
(`qml_dataset_mismatch`), `qml_train.resolve_data_params` takes `x*`-prefixed
or explicit `data_params` and checks the same count.
Kernel-file-access alternative is a dead end as a *feature*: lab code runs
via `_usercode.run_namespace` exec with full builtins, so user code *can*
`open()` host paths today, but no analysis reads a namespace dataset —
unreproducible, unhashed, and outside the job's provenance. Keep file
resolution inside the job-worker subprocess via the capability snapshot.

### Angle scaling done right (the 2pi bug class, current state)
Current `qml_data._scale` (post-fix):
`((raw-lo)/span * 2pi) % 2pi`. Verified live: `_scale([[0,1],[2,3],[1,2]])`
→ column mins **and maxes both 0.0** (max wraps onto min) — the `%` "fix"
swapped an out-of-contract `2pi` for a silent feature collision, worst for
user data where extremes are often the informative points.
Correct pattern:
1. Fit `lo/hi` on the **train split only**, persist them, clip test/OOD rows
   into range (no leakage; reproducible at inference/hardware time).
2. Prefer a range with no wrap identification: `[0,pi]` **inclusive** —
   `pi != 0` as a rotation on probabilities, so the max stays distinct
   (verified: same input → `[[0,0],[pi,pi],[pi/2,pi/2]]`, OOD clipped).
   If `[0,2pi)` is required (phase/RZ-after-H encodings), use half-open by
   construction: `np.minimum(scaled, np.nextafter(2pi,0))`
   (`6.283185307179585`), never `%`.
3. Choose range/bandwidth per gate, expose it as a setting: single
   `RX/RY` on `|0>` is only distinguishable on `[0,pi]`; Schuld, Sweke &
   Meyer, Phys Rev A 103, 032430 (arXiv:2008.08605) — a data-encoding gate
   `exp(-i s x G)` makes the model a partial Fourier series whose
   frequencies scale with `s`; baked-in `2pi` aliases/concentrates kernels.
4. Constant column (`span=0`) → 0 or drop with a note; percentile clip
   before min-max for outlier-heavy user columns.
5. Tests: min/max endpoint rows distinct, constant column, train-only fit
   (perturbing test rows must not move train angles), OOD clipping, and
   `lo <= X <= hi` (or `< hi` for the 2pi variant) assertion.
Note: Qiskit's `ZZFeatureMap` (IBM docs, `quantum.cloud.ibm.com/docs/en/api/
qiskit/qiskit.circuit.library.ZZFeatureMap`) uses `phi(x,y)=(pi-x)(pi-y)` —
a *two-parameter* angle, which `convert._qiskit_angle` rejects as
`nonlinear_parameter`; ZZ-style maps cannot enter the IR until either the
user writes the pairwise product as a precomputed extra data column or the
IR grows product terms. Angle/ReUpload-style one-feature-per-parameter maps
are the supported class.

## (b) Trained variational circuit → real hardware

### What exists
- Training returns plain values only: `qml_train.py` result
  `initial_parameters`/`final_parameters` `{name: float}` (trainable subset),
  `data_params`, `observable` as Pauli text. No circuit object or IR is in
  the result — inference must rebuild the circuit from the original code.
- IR is inbound-only: `convert.py __all__=[from_qiskit,from_cirq,from_object]`;
  there is no `to_qiskit/to_cirq`. Binding semantics to reuse:
  `ir.ParamCircuit.bind_vector` / `param_index` (angle = `coeff*value+offset`
  per `ParamRef`; `parameters` is the canonical order).
- Hardware API is concrete-object, counts-only: `hardware/base.py`
  `HardwareProvider.submit_job(circuit_obj, backend, shots)->JobHandle`,
  `get_results` returns `{"measurements": counts}` in every real provider
  (ibm/ionq/braket/azure/quantinuum). `server.py _prepare_hardware_payload`
  execs user code and `_extract_circuit_for_provider` picks a
  QuantumCircuit/Cirq Circuit/CUDA-Q kernel by provider order; `hardware_submit`
  is single-circuit. `executor.transpile()` is metrics-only (Qiskit
  `transpile(basis_gates,coupling_map,optimization_level)`, returns
  depth/counts) — not a submit path. Google provider is a stub
  (`connect()->False`, submit `NotImplementedError`), so Cirq circuits reach
  hardware only through non-Google providers that accept/convert them.

### Recommended path (no exporter): bind on the native object
1. Re-exec the original code (the `_usercode.LoadedCircuit.source_object`
   route) and merge bindings **by name**:
   `final_parameters ∪ {data_params: scaled test row}` using the *stored*
   scaler from (a) — a fresh min-max on the test row silently changes the
   model.
2. Qiskit: `qc.assign_parameters({p: v for p in qc.parameters})` — do NOT
   re-apply IR `coeff/offset` (the native `ParameterExpression`s already
   carry them). Cirq: `cirq.resolve_parameters(c, cirq.ParamResolver({...}))`
   keyed by `sympy.Symbol` name (quantumai.google/cirq ParamResolver docs).
   Assert no free parameters remain (IBM `SamplerV2` PUBs accept parameter
   value arrays, but Nuclei's provider passes none).
3. Measurements: IR conversion *drops* measurements (`from_qiskit/from_cirq`
   note "dropped N measurements"), so the native source object is again the
   right artefact — it keeps the user's measure ops; if absent, add
   `measure_all()` before binding. An IR exporter would have to re-add them.
4. Transpile once per backend: IBM provider already does
   `transpile(circuit_obj, backend=be)` then `SamplerV2(be).run([t],shots)`
   (`ibm_provider.py submit_job`) — but with no `optimization_level`/seed and
   per-job; for batch inference prefer transpile-the-symbolic-circuit-once +
   Sampler/Estimator PUB parameter arrays, which needs a provider-level
   batch API (`submit_job` is one circuit → one job today; N test points =
   N jobs otherwise).
5. Score from counts: the classifier is `sign(<O>)` for a `PauliSum`
   observable. Sampler counts give Z-basis bitstrings only — computing
   `<O>` needs parity averaging for Z-type terms and basis rotations
   (extra circuits per commuting group) for X/Y terms, or an `EstimatorV2`
   path that no Nuclei provider exposes yet. Mind endianness: IR is
   little-endian (qubit q = bit q, `ir.py`); Qiskit count keys are
   big-endian strings (leftmost = highest classical bit) — reverse before
   parity. Shots set the `±1/sqrt(shots)` noise floor on `<O>` near the
   decision boundary; report it, don't hide it.

### Path 2 (new `kernel/trainability/export.py`), if code re-exec is unwanted
Walk `bind_vector(values)` over `gates.py GATE_SPECS` — the full set
(I,H,X,Y,Z,S,SDG,T,TDG,SX,SXDG,CX,CY,CZ,CH,SWAP,ISWAP,CCX,CCZ,CSWAP,
RX/RY/RZ,P,U,RXX/RYY/RZZ/RZX,CRX/CRY/CRZ,CP) maps 1:1 to Qiskit ops and to
Cirq (`LineQubit.range(n)` in IR index order; Cirq rotations are
exponent-of-pi: `RX(a) = cirq.rx(a)`, `XPowGate(exponent=a/pi)` — mirror of
`from_cirq`'s `_scale(t, pi)`). Verify by round-trip
`to_qiskit -> from_qiskit` IR-hash equality (`ir.ir_hash`) and unitary
equivalence at random binds for small n. This also enables CUDA-Q/Q# IR
origins later, which Path 1 cannot serve (no native object to bind).
Out of scope either way: hardware *training* — the Lab needs exact batched
`KernelProgram.value_and_grad` (adjoint) expectations; no provider exposes
expectations or gradients. Quantum-kernel inference on hardware
(fidelity via compute-uncompute/SWAP-test circuits) is a separate feature
from variational inference and is not implied by the path above.
