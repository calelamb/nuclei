# R-F report: Lab prerequisites (R-5) + Discovery sandbox (R-19)

Branch `prd15/r-f` in `/home/calelamb/Desktop/code/nuclei/.worktrees/prd15-u/r-f`, base b9e3378. Commit 1cfb8fa.

## Implemented

R-5 (Trainability converter)
- `kernel/trainability/_decompose.py` (new): bounded decomposition helpers, `MAX_DECOMPOSE_LEVELS = 4`.
- `convert.py`: composite instructions (library circuits, `to_gate()` blocks, `PauliEvolutionGate`, Cirq `CircuitOperation`/`ParallelGate`/QFT/...) are expanded through their own definition, at most 4 levels. All leaves share the composite's `source_index`, so `source_line` tracing is preserved. The level goes in `notes` ("decomposed composite 'EfficientSU2' into elementary gates (level 1)", ` xN` for repeats).
- Only composites expand. Standard gates the IR lacks (`ecr`), `unitary`/state-prep, opaque gates and measurement/reset/conditionals inside a block stay `unsupported_gate` and name the op (inner op name plus "(inside composite 'X')"). Unknown-name check now runs before angle conversion so e.g. `unitary` is named instead of "non-numeric gate parameter ndarray".
- `from_qiskit/from_cirq/from_object(..., decompose=None)`; `None` follows `NUCLEI_IR_DECOMPOSE` (default on).

R-19 (Discovery sandbox)
- `kernel/discovery/landlock.py` (new): ctypes-only Landlock (syscalls 444-446), ABI probe, ruleset built by a trusted launcher (`python -I landlock.py <spec> -- cmd`) that sets no_new_privs, restricts itself, then execv's the worker. Read+exec: interpreter/venv, `kernel/`, system libs; read-write: scratch only (no exec); optional extra read-only roots (project root); list-only on the repo root (import system needs it); TCP bind/connect denied on ABI >= 4; abstract-unix/signal scope on ABI >= 6.
- `isolation.py`: `MODE_LANDLOCK`; `userns_probe()` (runs `bwrap --ro-bind / / true`, names `apparmor_restrict_unprivileged_userns`); tier order bwrap then landlock; `observe_confinement()` runs a script through the wrapper and derives `reads/writes/network` from what was actually denied; `isolation_detail` is now `{reads, writes, network}`; `IsolationInfo.needs_consent`; `PROCESS_CAPABILITY_TEXT`; `command(..., extra_read_roots)` for bwrap/sandbox-exec/landlock.
- `prescreen.py` (new): AST scan with rule ids (dunder_import, dynamic_code, importlib, shutil, open_write, open_dynamic_mode, os_open, file_removal, blocked_getattr, introspection), alias tracking (`import os as o`, `from os import remove`), literal-string folding for getattr/subscript.
- `sandbox.py`: `prescreen_response()` (applies on a process tier, and for `claude` origin at any tier), `run_candidate(origin=, project_root=)`, process fallback after a wrapper failure is prescreened, `kill_process_group()` SIGTERM then SIGKILL, `landlock:` added to wrapper-failure hints, details taken from the tier's `IsolationInfo`.
- `manager.py` / `handlers.py`: `isolation_consent` (bool) and `origin` fields on `discovery_evaluate`; without consent on a process-only host the kernel answers `isolation_consent_required {run_id, candidate_id, capability_text, isolation}`; the manager prescreens before the sandbox (unknown origin is treated as `claude`); a rejection is a failed evaluation `{stage: sandbox, code: prescreen_rejected}`.
- Docs: `docs-site/src/content/docs/research/sandboxing.mdx`.

The owner's box (Ubuntu 24.04, kernel 7.0): `detect_isolation()` reports `landlock`, ABI 8, detail `{reads: restricted, writes: scratch-only, network: denied}`; `userns_probe()` reports "setting up uid map: Permission denied (kernel.apparmor_restrict_unprivileged_userns=1 ...)". A real `qec_memory` seed evaluation through `DiscoveryManager` scored (3.697) under landlock; the same program with `import shutil` was rejected by the pre-screen.

## TDD evidence

RED (convert), with a stub `_decompose.py` so the module imports:
`.venv/bin/python -m pytest kernel/tests/test_trainability_convert_composite.py` -> `18 failed, 6 passed`; failures were `IrError: unsupported_gate: gate 'EfficientSU2' is not supported by the Trainability Lab` (also ZZFeatureMap, `wrapper_block`, `level4`) as expected.

RED (sandbox/prescreen/isolation), against a `git archive b9e3378 kernel` copy with my three new/updated test files dropped in: 3 collection errors, e.g. `ModuleNotFoundError: No module named 'kernel.trainability._decompose'` and missing `kernel.discovery.prescreen`/`landlock` imports. Honest note: I wrote the sandbox implementation before its tests; the RED for those files is the collection failure on the base tree, not a per-test failure sequence.

GREEN: `pytest kernel/tests/test_trainability_convert_composite.py kernel/tests/test_discovery_prescreen.py kernel/tests/test_discovery_isolation.py` -> all pass (convert 30, prescreen 60, isolation 37 passed / 9 skipped: sandbox-exec is macOS only, bwrap blocked here).

## Full suites

- `.venv/bin/python -m pytest kernel/tests -q` (final, after commit): `1 failed, 2824 passed, 14 skipped`. The one failure is `test_discovery_seeds.py::test_seed_runs_under_default_isolation` (see concerns).
- Minimal venv (uv, `kernel/requirements.txt` + pytest only, as the CI `pytest-minimal-venv` job): `test_trainability_convert_composite.py` + `test_discovery_optional_deps.py` -> 58 passed, 4 skipped; `test_discovery_prescreen.py` + `test_discovery_isolation.py` -> 60 passed, 1 skipped.
- Docs tests (`test_docs_examples`, `test_docs_fixtures`, `test_docs_lab_fixtures`): 73 passed.
- Not run: vitest/tsc/eslint/cargo (no TS or Rust touched).

## Files changed

New: `kernel/discovery/landlock.py`, `kernel/discovery/prescreen.py`, `kernel/trainability/_decompose.py`, `kernel/tests/test_discovery_prescreen.py`, `kernel/tests/test_trainability_convert_composite.py`, `docs-site/src/content/docs/research/sandboxing.mdx`.
Modified: `kernel/discovery/{isolation,sandbox,manager,handlers}.py`, `kernel/trainability/convert.py`, `kernel/tests/test_discovery_isolation.py`.
`kernel/trainability/_circuit_walk.py` was NOT changed: it needs nothing (leaves share `source_index`, which `source_key` already uses).

## Decisions

- Decision: `landlock.py` and `_decompose.py` are new files beside the owned ones (isolation.py would pass 600 lines otherwise).
- Decision: the launcher approach (`python -I landlock.py ... -- worker`) instead of a preexec hook, because `run_process` is unowned and has no hook; the launcher runs in the child before the candidate starts, which is the same guarantee.
- Decision: tier order is bwrap, then landlock (bwrap also gives a PID namespace and private /tmp); landlock is chosen only when bwrap's userns probe fails or bwrap is absent.
- Decision: `isolation_detail` gained `writes` and `network` keys; for landlock all three come from `observe_confinement`, for bwrap/sandbox-exec they are the documented static values. The ABI < 4 case honestly reports `network: unrestricted`. I updated the three equality assertions in `test_discovery_isolation.py` accordingly.
- Decision: `NUCLEI_DISCOVERY_ISOLATION=process` is an operator choice and exempts consent (`consent_exempt`); existing handler tests force it and stay green.
- Decision: consent is per request (`isolation_consent: true` on each `discovery_evaluate`), never remembered by the kernel. The "exact capability text" is not specified anywhere in the spec, so I defined `isolation.PROCESS_CAPABILITY_TEXT` (also sent as `capability_text`); F-3's dialog must render it verbatim.
- Decision: the pre-screen is enforced in the manager and in `run_candidate` only when the caller names an `origin` (and on the process fallback after a wrapper failure). Making it unconditional inside `run_candidate` would break the PRD 14 hostile-program security tests, which deliberately run `__import__`/`open(..., 'a')` under `process` to test the worker's own defenses. `discovery_evaluate` with no `origin` is treated as `claude`.
- Decision: ZZFeatureMap. Its default (>= 2 qubit) encoding angle `2(pi-x_i)(pi-x_j)` is bilinear; the IR is single-parameter-affine, and spec 03 states non-linear encodings are rejected with `nonlinear_parameter`. So decomposition works (verified against Qiskit's statevector once x is bound, which is how a kernel evaluates it) but an UNBOUND `ZZFeatureMap(n>=2)` still raises `nonlinear_parameter` (tested). The brief's "ZZFeatureMap reaches trainability_inspected with correct parameter counts" holds for bound data and for first-order feature maps (`PauliFeatureMap(paulis=["Z"])`), not for unbound entangling ZZ terms. Widening it needs an IR change (not mine).
- Decision: PRD 14 exploit fixture `ss-composite-gate-cost-laundering` expects `ir_conversion` to reject opaque composites, so the candidate sandbox sets `NUCLEI_IR_DECOMPOSE=0` (sandbox.py, mirrored by a pinning test). The Lab decomposes; Discovery candidates behave exactly as before.
- Decision: Cirq composites are an allowlist (CircuitOperation, ParallelGate, QFT, PhaseGradient, PauliStringPhasor, PauliSumExponential, ControlledGate, Clifford gates) so `MatrixGate` and `SWAP**t` stay unsupported as in the existing tests.

## Self-review findings (fixed)

- Per-leaf counting bug in the decomposition log (counted each leaf, not each composite): fixed to count once per composite with the deepest level.
- Landlock probe initially failed (the import system lists the repo root): added a list-only rule on the repo root.
- Prescreen missed `Path(...).open('w')` (mode is the first positional argument): fixed with receiver-aware mode detection.
- `_interpret`/`_error` are called with a bare tier string by other tests; kept backward compatible via `_as_info`.
- Existing PRD 14 exploit replay failed after global decomposition: resolved with the env switch above.

## Concerns / needed from the controller (files I do not own)

1. `kernel/tests/test_discovery_seeds.py:129` asserts `ev["isolation"] in ("process", "sandbox-exec", "bwrap")`; on any host where the new tier is selected (the owner's box, CI ubuntu-latest) it must include `"landlock"`. One-line fix, not made because the file is not in my ownership. This is the single red test in the full kernel suite.
2. `kernel/lab_proc.py::kill_process_group` is still SIGKILL-only (owned by F-1/R-B). The SIGTERM-then-SIGKILL helper is `kernel.discovery.sandbox.kill_process_group(pgid, grace_seconds=2.0)` (tested with a child that ignores SIGTERM); R-B/F-1/V1 should call it for jobs with children.
3. `docs-site/astro.config.mjs` sidebar needs `'research/sandboxing'` (page exists and builds; it is just not in the nav). `discovery-engine.mdx` "Sandbox isolation" still says Linux bwrap is untested and lists no landlock; it should link to the new page.
4. F-3 (frontend): send `isolation_consent` and optionally `origin`; render `capability_text`; `DiscoveryIsolationDetail` in `src/types/discovery.ts` is `{reads}` only and should gain `writes` and `network`.
5. Verify-worker unit (V1): use `iso.detect_isolation().needs_consent`, `sandbox.prescreen_response(program, info, origin)` and `run_candidate(origin=, project_root=)`. `project_root` read-only grants exist for landlock, bwrap and sandbox-exec; the macOS and bwrap paths could not be exercised on this Linux box.
6. A mid-run wrapper failure still demotes to `process` and runs the (now prescreened) candidate without a fresh consent check; the record says `process` honestly.
7. UDP/raw sockets are not covered by Landlock and abstract-socket/signal scoping needs ABI 6; documented in sandboxing.mdx. The pre-screen is a speed bump (mode computed at run time through an unknown receiver slips past), also documented.

## Review round 1 fix report

Branch `prd15/r-f`, fix commit on top of reviewed head 1cfb8fa.

### Fixed
- **Important 2, consent and pre-screen on `discovery_audit`.**
  - `handlers.py` gates `discovery_audit` before it reaches `audits/handlers.py`: same `isolation_consent` / `origin` fields, same `isolation_consent_required` error (with `capability_text`), then the static pre-screen (a missing `origin` is `claude`, i.e. untrusted at every tier). A rejection is a `prescreen_rejected` error and the audit is not accepted. `discovery_audit_cancel` is not gated.
  - `manager.py`: new `require_consent(consent: bool)`; `check_consent(request)` delegates to it. `handlers._require_consent` is shared by evaluate and audit.
  - `sandbox.run_candidate`: `origin=None` is now untrusted (`claude`), matching the manager. This closes the same hole for `audits/runner.py`'s two fresh-sandbox runs (they call `run_candidate` without an origin; that file is not owned, so the gate at the router is the primary control and this is defense in depth).
  - Tests (8 new, in `test_discovery_isolation.py`): no consent on a process host -> `isolation_consent_required` and no audit started; consent runs it; consent is not remembered; a hostile program is rejected even with consent; under an OS tier an untrusted/missing origin is pre-screened and `origin: "user"` is trusted; malformed consent flag / unknown origin -> `invalid_request`; `run_candidate` with `origin=None` or `claude` rejects a hostile program on process and landlock tiers. RED first: the first new test timed out waiting for an error because the audit was accepted and finished (`got ['discovery_audit_accepted', 'discovery_audit_result']`).
- **Important 3, PRD 14 regression.** `test_discovery_seeds.py` now asserts `ev["isolation"] in isolation.ALL_MODES` (new tuple exported by `isolation.py`, contains landlock) and sends `isolation_consent: true` so the test also passes on a process-only host. Applied here because the file is unowned but the unit cannot merge red; the edit is two lines in that file.
- **Minor 6 (docs)**: removed the unimplemented "needs project files" sentence from `sandboxing.mdx`, documented the audit gate and the "missing origin is untrusted" rule.

### Knock-on test edits (needed by the stricter default; flagged because one file is not owned)
- `test_discovery_isolation.py` (owned): `test_landlock_denies_rmtree` and `test_wrapper_failure_falls_back...` now pass `origin="user"` where they rely on the OS tier alone.
- `test_discovery_security.py` (PRD 14, unowned): `test_setsid_and_double_fork_leave_no_survivor` monkeypatches `kernel.discovery.sandbox.prescreen_response` to a no-op. That test deliberately runs fork/setsid/open-for-append code to prove the worker's own defenses; the pre-screen (now applied to every untrusted run, and to every run on the process tier, where `origin="user"` would not help) rejects it before it starts. No other test in the suite needed a change.

### Not fixed (needs a ruling or a file R-F does not own)
- **Important 1, unbound `ZZFeatureMap`.** Not changed. The three options all need files outside this unit: (a) product angles in the IR means `ir.py` plus every consumer that assumes one-parameter-affine angles (parameter shift, PPE, compiler, landscape); (b) an inspect-only path means `inspect.py`/`_usercode.py` (R-B territory) catching `nonlinear_parameter` and answering `trainability_inspected` with `parameters` from the circuit and a note, while every analysis still refuses the circuit; (c) amend the criterion. Recommendation: (b), because spec 03 deliberately rejects non-linear encodings and (b) keeps that while giving idea 4 its parameter count. `convert.py` already exposes the data needed (`circuit.parameters` is read before the failure). The existing test `test_entangling_zz_feature_map_with_free_data_keeps_the_nonlinear_parameter_error` documents today's behaviour and must flip when the ruling lands.
- **Important 4, frontend consumer of the new tier.** Not changed (TypeScript files belong to F-3). Handoff, to land with R-F and before any build the owner runs (on the owner's box the kernel now reports `landlock`):
  1. `src/types/discovery.ts:18`: add `'landlock'` to the isolation union; `DiscoveryIsolationDetail` becomes `{reads, writes, network}` (all three strings the kernel measured).
  2. `src/services/discovery/guardrailStats.ts` `isolationNote()`: add a `landlock` case (it returns `undefined` today, so the note is blank). The sentence must be driven by `isolation_detail.network`: `denied` may say outbound TCP is blocked; `unrestricted` (Landlock ABI < 4) must say the network is NOT blocked. Never reuse the bwrap wording by tier name.
  3. `src/services/discovery/honesty.ts:16`: replace "Linux bwrap, untested on Linux" with the tiers the kernel now has (landlock verified on Linux; bwrap only when user namespaces work; sandbox-exec macOS). Also render `capability_text` verbatim in the consent dialog and send `isolation_consent` / `origin` (Concern 4 earlier), now for `discovery_audit` as well.
- **Important 3 (R-B boundary, R-C review)** is not applicable here.

### Test evidence
- `.venv/bin/python -m pytest kernel/tests/test_discovery_isolation.py kernel/tests/test_discovery_security.py kernel/tests/test_discovery_prescreen.py kernel/tests/test_discovery_seeds.py -q` -> `124 passed, 9 skipped`.
- `.venv/bin/python -m pytest kernel/tests -q` (full) -> `2833 passed, 14 skipped` (previously `1 failed, 2824 passed`).

## Fix round 2

Finding: `run_candidate` treats `origin=None` as untrusted, but neither production caller passed an origin, so trusted origins ('user'/'ast'/'symmetry') were pre-screened anyway, and an audit of a pre-screen-rejected scored candidate became a false 'exploit'.

- RED: 4 new tests failed (AuditRequest had no `origin`; manager never passed `origin`; pre-screened audit gave 'exploit').
- Fix: `manager._evaluate` passes `origin=req.origin or "claude"`; `AuditRequest.origin` (optional, parsed by `parse_audit` via the same `_origin` validator) goes to `_sandbox_once(..., origin=req.origin or "claude")`. Sandbox stubs in tests accept `origin`.
- Tests: manager hands origin to the sandbox runner (user -> user, missing -> claude); audit runner passes origin on both runs; `parse_audit` carries/validates origin; real `run_candidate` on a process tier with a hostile claude-origin program yields verdict inconclusive.
- Decision: a `prescreen_rejected` sandbox result in an audit is a skipped `sandbox_reproducible` check ("rejected by the pre-screen before it ran, so the audit cannot judge it"), giving verdict `inconclusive` (existing vocabulary), never `exploit`, regardless of scored status.
- Verification: covering suites 216 passed, 9 skipped; full kernel suite 2837 passed, 14 skipped.
