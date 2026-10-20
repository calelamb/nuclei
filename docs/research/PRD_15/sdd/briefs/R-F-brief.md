# Brief — PRD 15 unit R-F

Plan: docs/research/PRD_15_QUANTUMNESS_LAB.md (master). Specs: docs/research/PRD_15/*.md. This brief is your requirements; values in it are binding verbatim.

## Your unit (master plan rows — §5.1 Track R table and/or §7 wave table)

| **R-F Lab prerequisites + sandbox** (Wave 0a) | R-5 bounded decomposition (≤ 4 levels) of `BlueprintCircuit`/composite instructions in `convert.py` with `source_line` tracing preserved and the level in `notes`; R-19 isolation: **new `landlock` tier** in `kernel/discovery/isolation.py` (probe the ABI at startup — ABI 8 on the owner's Ubuntu 24.04 where `bwrap` is blocked by `apparmor_restrict_unprivileged_userns`; the trusted parent applies a ruleset before exec: read-only interpreter/venv, `kernel/`, system libs; read-write scratch only; project root read-only on request; TCP connect/bind denied on ABI ≥ 4; `isolation_detail.reads/writes` from the probe), `bwrap` userns probe, require per-session `isolation_consent` with the exact capability text on `process`-only hosts (kernel handling in `kernel/discovery/handlers.py` + the manager), **`kernel/discovery/prescreen.py`** static AST pre-screen (rejects `__import__`, `eval`/`exec`/`compile`, `importlib`, `open` in write modes, `os.remove/unlink/rmdir`, `shutil`, `pathlib` `write_*`/`unlink`, `getattr` on string literals naming blocked attributes; mandatory on `process` and for every `claude`-origin candidate), `kill_process_group` SIGTERM-then-SIGKILL for jobs with children; sandboxing docs | `kernel/trainability/convert.py`, `kernel/trainability/_circuit_walk.py`, `kernel/discovery/{isolation,prescreen,sandbox}.py`, `kernel/discovery/handlers.py` (consent branch), `kernel/discovery/manager.py` (consent), `kernel/tests/test_trainability_convert_composite.py`, `kernel/tests/test_discovery_isolation.py` (extend), `kernel/tests/test_discovery_prescreen.py`, `docs-site/.../sandboxing.mdx` | `EfficientSU2`/`TwoLocal`/`ZZFeatureMap`/`QFT`/`PauliEvolution` reach `trainability_inspected` with correct parameter counts; genuinely unsupported ops still `unsupported_gate` naming the op; a candidate calling `shutil.rmtree(<dir outside scratch>)` is denied or rejected under **each** tier (landlock/bwrap/sandbox-exec/process+prescreen); `discovery_evaluate` without consent on a `process` host → `isolation_consent_required {run_id, candidate_id}`; the owner's box reports tier `landlock` |
| **R-F** Lab prerequisites + sandbox | composite decomposition; `landlock` tier, probe, consent handling, `prescreen.py`, SIGTERM-then-SIGKILL | §5.1 |

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


## Audit items you close (docs/research/PRD_15/00_RELIABILITY_AUDIT.md)

### R-5 (High, PRD 15 critical) Trainability Lab rejects library/composite blocks
- Symptom: `unsupported_gate: gate 'EfficientSU2' is not supported by the Trainability Lab` for `EfficientSU2`, `TwoLocal`, `ZZFeatureMap`, `QFT`, `PauliEvolution` on `trainability_inspect`, `_lint`, `_start` (all three envs, `lab2.py`). Plain `rzz/rxx/ry`, `cry/u/ccx`, mid-file measure and Cirq grid ansatz all analyze fine (`status=complete`).
- Root cause: `kernel/trainability/convert.py:130,199` name-based lowering with no `decompose()` of `BlueprintCircuit`/composite instructions.
- Fix: before conversion, decompose composite instructions to a fixed point (bounded, e.g. 4 levels) using `QuantumCircuit.decompose`/Cirq `cirq.decompose`, preserving `source_line` tracing for the lint; report the decomposition level in `notes`. This is a hard prerequisite for PRD 15 idea 4 (`ZZFeatureMap` kernels) and for every ansatz built from library circuits.
- Regression tests: lab fixtures with `EfficientSU2`/`TwoLocal`/`ZZFeatureMap` produce `trainability_inspected` with correct parameter counts; `unsupported_gate` still returned for genuinely unsupported ops with the op named.


### R-19 (Med) Discovery sandbox is unavailable on this OS; falls back to unrestricted
- Symptom: `bwrap --ro-bind / / true` fails with `setting up uid map: Permission denied` (`kernel.apparmor_restrict_unprivileged_userns=1` on Ubuntu 24.04). Discovery evaluations report `isolation: "process"`, `isolation_detail.reads: "unrestricted"` (`iso.py`). This is honest (the UI label comes from the kernel) but it means candidate code runs with full user file access on the owner's box.
- Root cause: `kernel/discovery/isolation.py:224` selects bwrap whenever the binary exists; the verification step correctly downgrades. No fix needed in the label; a product decision is needed for PRD 15 idea 2 (Red Queen adversary running generated candidates) on Ubuntu 24.04 (AppArmor profile for bwrap, or require explicit user consent per run when isolation is `process`).


## Controller rulings for this unit (binding)
- You own your test files including any importorskip they need.
- landlock: this box is Ubuntu 24.04 kernel 7.0 (check /sys/kernel/security/lsm and the landlock ABI via the syscall); bwrap is installed but unprivileged userns may be blocked by apparmor_restrict_unprivileged_userns — probe, don`t assume. Prefer applying landlock via ctypes syscalls (no new dependency) in the trusted parent between fork and exec.
- PRD 14 behaviour must not regress: existing discovery/trainability suites stay green; isolation_detail semantics (reads restricted/unrestricted) stay honest.
