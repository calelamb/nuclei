# R-F review, round 1 (Lab prerequisites + sandbox, Wave 0a)

Range b9e3378..1cfb8fa (1 commit, 12 files). Review package: `reviews/R-F-r1.diff`.

**Verdict:**
- **spec_compliant = false.** The unbound `ZZFeatureMap` acceptance criterion is not met, consent covers only `discovery_evaluate`, and one PRD 14 suite test is red.
- **Quality = Needs fixes.**

## Spec compliance, file by file

| Owned file / brief item | Status |
|---|---|
| `kernel/trainability/convert.py` (R-5) | Done. Composites are decomposed (bounded at 4 levels). All leaves share the composite's `source_index`. Notes say "decomposed composite 'X' ... (level N)". Unsupported ops are still `unsupported_gate`, and the inner op is named. |
| `kernel/trainability/_circuit_walk.py` | **Listed, never touched.** The implementer argues nothing is needed, and `test_source_lines_are_preserved_through_decomposition` backs that up (Minor 1). |
| `kernel/discovery/isolation.py` | Done. Adds the `MODE_LANDLOCK` tier, `userns_probe` (names `apparmor_restrict_unprivileged_userns`), `observe_confinement` (reads/writes/network observed), `needs_consent`, `PROCESS_CAPABILITY_TEXT`, and `extra_read_roots`. |
| `kernel/discovery/prescreen.py` | Done. Every rule the brief names is present, plus `introspection` and `open_dynamic_mode`. |
| `kernel/discovery/sandbox.py` | Done. Adds `prescreen_response` and `kill_process_group` (SIGTERM, grace period, SIGKILL), and `run_candidate(origin=, project_root=)`. |
| `kernel/discovery/handlers.py` (consent branch), `manager.py` (consent) | Done for `discovery_evaluate` only (Important 2). |
| Tests: `test_trainability_convert_composite.py`, `test_discovery_isolation.py` (extended), `test_discovery_prescreen.py` | Done. |
| `docs-site/.../sandboxing.mdx` | Done (Minor 6). |
| New, unlisted: `kernel/discovery/landlock.py`, `kernel/trainability/_decompose.py` | New files, so no ownership conflict. Acceptable. |

Acceptance criteria:

| Criterion | Status |
|---|---|
| `EfficientSU2`/`TwoLocal`/`QFT`/`PauliEvolution` reach `trainability_inspected` with correct parameter counts | Met. Tested against Qiskit's statevector and over the socket. |
| `ZZFeatureMap` reaches `trainability_inspected` with correct parameter counts | **Not met when unbound** (Important 1). |
| Unsupported op named | Met. |
| `shutil.rmtree` denied under each tier | Met for landlock and process+prescreen. Skipped here for bwrap and sandbox-exec (cannot verify). |
| Consent → `isolation_consent_required {run_id, candidate_id}` | Met. The envelope also carries `capability_text` and `isolation`. |
| Owner's box reports `landlock` | Reported with evidence; the test itself monkeypatches `userns_probe`. |

## Important

1. **Unbound `ZZFeatureMap` still fails, now with `nonlinear_parameter`. The R-5 acceptance criterion and the stated prerequisite for idea 4 are not met.**
   - Where: `test_trainability_convert_composite.py::test_entangling_zz_feature_map_with_free_data_keeps_the_nonlinear_parameter_error`.
   - The brief names `ZZFeatureMap` explicitly ("reach `trainability_inspected` with correct parameter counts"). The audit calls R-5 "a hard prerequisite for PRD 15 idea 4 (`ZZFeatureMap` kernels)".
   - The fix covers bound data and first-order feature maps (`PauliFeatureMap(paulis=["Z"])`). The default entangling `ZZFeatureMap` that users write fails in the Lab, only with a different code than before.
   - The implementer cites spec 03 (non-linear encodings are rejected). That may be a genuine conflict between the plan and the IR, but the design rationale does not downgrade a missed requirement.
   - Fix: the controller rules on one of three options:
     - (a) The IR or inspect path accepts product-of-parameters angles for inspection and parameter counting only.
     - (b) `trainability_inspect` reports the parameter count with a `nonlinear_parameter` note rather than failing.
     - (c) The acceptance criterion is formally amended, and idea 4's owners are told that unbound ZZ maps are out.

2. **Isolation consent and the pre-screen cover only `discovery_evaluate`. `discovery_audit` (Red Queen) still runs client-supplied candidate programs on a process-only host with no consent and no pre-screen.**
   - Where: `kernel/discovery/audits/runner.py:103-105,175-192` calls `run_candidate(request, wall_seconds=..., cancel_event=...)` with no `origin`. With no `origin`, `run_candidate` skips the pre-screen on the first attempt.
   - The message is routed through `kernel/discovery/handlers.py:235`, which this unit owns: the `discovery_audit*` prefix branch.
   - Why it matters: R-19's product question was explicitly about "PRD 15 idea 2 (Red Queen adversary running generated candidates)". The consent gate this unit adds does not cover the Red Queen path, which is the reason consent exists. A process-only host (Windows, or Linux without landlock or bwrap) runs adversarial programs with the user's full file access, unprompted.
   - It is also inconsistent: the manager treats a missing origin as `claude` (pre-screened at every tier), while `run_candidate` treats it as trusted.
   - Fix:
     - Apply `manager.check_consent`, or an equivalent `iso.detect_isolation().needs_consent` check, in the `discovery_audit` branch of `handlers.py`, and accept the same `isolation_consent` field.
     - Make `run_candidate` treat `origin=None` as untrusted, like the manager. The PRD 14 hostile-program tests can pass an explicit trusted origin (`"user"`).
   - If `audits/` must not be edited, at least gate at the router (owned) and record the handoff.

3. **A PRD 14 suite test is red on every host that selects landlock, including the owner's box and probably CI `ubuntu-latest`. This violates global constraint 7.**
   - Where: `kernel/tests/test_discovery_seeds.py:129` asserts `ev["isolation"] in ("process", "sandbox-exec", "bwrap")`. The report shows `1 failed, 2824 passed`.
   - The file is outside R-F's ownership, so this needs routing. The unit still cannot merge green.
   - Fix: the controller makes the one-line fix to include `"landlock"`, preferably asserting membership in a set exported by `isolation.py`, in this wave and before merge.

4. **The kernel now emits an isolation tier and detail shape that the shipped UI cannot describe. On the owner's box the honesty note goes blank.**
   - Shape change: `isolation: "landlock"` and `isolation_detail: {reads, writes, network}` cross the socket.
   - `src/types/discovery.ts:18` is `'process' | 'bwrap' | 'sandbox-exec'`.
   - `src/services/discovery/guardrailStats.ts` `isolationNote()` has no `landlock` case and returns `undefined` at runtime.
   - `src/services/discovery/honesty.ts:16` still says "Linux bwrap, untested on Linux".
   - On a landlock host with ABI < 4, the UI would reuse the bwrap "blocked network" wording if a case were added naively. `network` must drive that sentence.
   - Principle 4 (honest by construction) applies: the UI must never be blank, or say more than the kernel measured.
   - The report's Concern 4 mentions only the types.
   - Fix: hand off explicitly to F-3 (or the controller) with these three call sites, scheduled to land with R-F, or before R-F reaches a build the owner runs. A `landlock` note must use `isolation_detail.network`.

## Minor

1. **`_circuit_walk.py` listed but untouched.** The justification and test are adequate. Record the decision in the plan's ownership table.
2. **`kill_process_group` is not wired, and its "gone" check can misfire.**
   - No caller uses it: `lab_proc.kill_process_group` is still SIGKILL-only, as the implementer flagged. So the brief's "SIGTERM-then-SIGKILL for jobs with children" is not yet in effect.
   - Its "group gone" check is `os.killpg(pgid, 0)`, which keeps succeeding while an unreaped zombie leader remains. A caller that does not reap concurrently always waits the full grace period and gets `False`.
   - The tests hide this with a reaper thread (`_spawn_group`).
   - Before wiring: accept an optional `Popen` and poll `proc.poll()` for the leader, or document that the caller must reap concurrently.
3. **Mid-module `importorskip` skips the landlock tests.** `pytest.importorskip("pymatching")` sits in the middle of `test_discovery_isolation.py` (diff ~2009), and the file already starts with `importorskip("stim")`. Together they skip the whole module, including the landlock enforcement, ABI and userns probe, consent and `kill_process_group` tests, in any env without stim or pymatching. That includes the stock-venv CI job: the report's minimal-venv "1 skipped" is this module. Landlock and consent are stock-venv features (principle 5). Move the stim-free tests into their own module, for example `test_discovery_landlock.py`, and keep the pymatching-dependent consent tests separate.
4. **Decomposition switched by a hidden env var.** `NUCLEI_IR_DECOMPOSE` is a process-env behaviour switch read inside library code (`_decompose.decompose_enabled`). The sandbox forces it to `0` so the PRD 14 exploit fixture keeps working. As a result the Lab and Discovery give opposite verdicts for the same `EfficientSU2` program, and the coupling is invisible at call sites. Prefer explicit `decompose=False` at the candidate worker's conversion call, which needs the owner of `candidate_worker.py`. Otherwise document the asymmetry in `discovery-engine.mdx`.
5. **Landlock grants wider than the docs say.**
   - The `ls` (READ_DIR) rule on `repo_root()` is "path beneath", so every directory under the repo root is listable. This is documented.
   - `extra_read_roots` (the project root) get `_ro_rights`, which includes EXECUTE, while the docs say "read-only". Use `_FS_READ` alone for extra roots.
   - `kernel/discovery/landlock.py` `apply_spec`.
6. **Docs describe behaviour that is missing.**
   - `sandboxing.mdx` claims a candidate that needs project files is "reported as unverifiable ('needs project files'), never silently rejected". Nothing in the diff implements that.
   - The manager never passes `project_root`.
   - The page is not in the sidebar.
   - `discovery-engine.mdx` and CLAUDE.md's "Honest limit" paragraph still describe only sandbox-exec, bwrap and process.
   - `messages-lab.mdx` lacks `isolation_consent`, `origin` and `isolation_consent_required`.
   - Remove the unimplemented sentence now; hand the rest to X.
7. **Inconsistent fallback detail.** `manager._apply_sandbox_record` (diff ~1064) defaults `isolation_detail` to `{"reads": "unrestricted"}`, a one-key shape, while everything else now emits three keys. Default to the full process detail (`iso._PROCESS.detail`).
8. **Mutable module-level state.** `isolation._skip_notes` is mutable module state. It is mutated under `_lock`, so it is safe, but it is against the immutability rule. Return the notes from `_candidate_modes()` instead.
9. **Pre-screen precision.**
   - Any load of a name `compile`, `eval` or `exec` is flagged, including a user's own function named `compile` (false positive).
   - `zipfile.ZipFile(p, "w")` and similar writers are not caught.
   - Acceptable for a speed bump, but add both cases to the docs' "not a wall" note.
10. **TDD order.** By the report's own account, the sandbox, pre-screen and isolation code was written before its tests. The RED is only a collection failure on the base tree, which falls short of constraint 3 (RED first, with evidence). The tests are behavioural (real Landlock enforcement, real processes), which lowers the impact.
11. **Consent is per request, not per session.** The brief says "per-session `isolation_consent`". The kernel takes it per request and never remembers it, leaving session memory to the frontend. That is defensible, but F-3 must implement the session memory. Record the decision in the protocol docs.

## Test evidence
- Reported: convert 30, prescreen 60, isolation 37 passed / 9 skipped.
- Full kernel suite: `1 failed, 2824 passed, 14 skipped`. The failure is Important 3.
- Minimal venv: composite and optional-deps 58 passed, 4 skipped; prescreen 60 passed, but isolation is skipped whole (Minor 3).
- Docs fixture tests: 73 passed.
- No warnings were reported, though `PendingDeprecationWarning` is filtered for Qiskit library circuits.
- No Qiskit 2.x run is reported for the decomposition code, although R-14 requires PRD 15 Qiskit code to run on both majors (see cannot_verify).
