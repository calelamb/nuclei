# Review R-D (round 1): corpus golden (G0) + wave tooling

Base b9e3378, head 349c237 (4 commits). Package: `reviews/R-D-r1.diff` (read once).

## Verdict

- Spec compliance: **yes**. Every owned deliverable exists. No file outside the brief's ownership was touched.
- Quality: **Needs fixes**. There is 1 Important finding (the q31 golden is ungated and depends on the machine), plus Minor items.

## Spec compliance, file by file (owned list in the brief)

| Owned file | Status |
|---|---|
| `kernel/tests/research_corpus/**` (loader + `scout/`) | Present. The glob loader (`loader.py`), the runner, 78 scout programs (c01-15, e01-09 without e04, q01-40, qs01-06, r01-05, s01-03, z04 = 78) and `expected.yaml`. Per-env overrides use `envs:`. Strict xfail is tagged with R-ids, and `overrides.yaml` lets a later unit flip an entry without editing R-D files. `gates/` holds g01-g04. No Learn-mode programs. |
| `kernel/tests/test_research_corpus.py` | Present. Strict xfail with `raises=CorpusMismatch`. `CorpusDrift` catches a known bug whose shape changed. A release-ledger test exists. An env probe refuses a mismatched interpreter. |
| `kernel/tests/_kernel_client.py` (from `kclient.py`) | Present. Real authenticated v2 handshake with an HMAC proof check, a private `NUCLEI_RUNTIME_DIR` (constraint 6 met), all `NUCLEI_*` and DISPLAY variables dropped, and a process group. |
| `scripts/check-app-env.sh` (G4) | Present. |
| `scripts/make-test-venvs.sh` | Present. Builds full (3.12 / Qiskit 1.x through the requirements.txt pin `<2.0`), qk2 (3.13 / Qiskit 2.x), minimal, and app-env (parsed from `frameworks.rs`). |
| `scripts/check-wave-ownership.py` | Present. I ran it read-only on the plan: 40 units, 4 spec files, and it parsed 6, 8, 7 and 8 spec rows. That matches the report: 12 findings, which the report condenses into 7 lines. All 12 are findings about the PLAN, as the ruling requires. |
| `.github/workflows/kernel-tests.yml` | Present. Jobs: `corpus-minimal`, `corpus-app-env`, `corpus-full`, `pytest-qiskit2` (R-C's handed lines), `pytest-minimal-venv` running the WHOLE `kernel/tests` (R-E's command, with `qdk` added to the absent list), `wave-ownership`, and a per-package 80 % coverage gate. The Qiskit-2 "matrix leg" is a separate job rather than a matrix entry, which is acceptable. |

Acceptance "check-wave-ownership.py passes on §7 and every spec table" is **not met**, and the cause is the plan's 12 findings, not the tool. The `wave-ownership` job will be red on every PR until the controller amends the plan. Two of the findings are R-D's own row (`research_corpus/**` against R-A's `r_a/**` and R-B's `r_b/**`). The controller has to act on these. They are not a defect in R-D.

Extras: the `launch="module"` option, the `NUCLEI_CORPUS_RELEASE` ledger gate, and `--json` / `--scope` on the checker. All are small and justified; nothing is over-engineered.

## Important

1. **`kernel/tests/research_corpus/scout/expected.yaml:352` (q31-26-qubit-ghz-too-big): an unbounded allocation runs on hosts without prlimit, and the desired golden depends on the machine.**
   - The report says allocation gates "(`q31`, `g01`, `g02`) run only under an address-space cap". That is true for g01 and g02 (`gates/expected.yaml` sets `needs_memory_limit: true`). **q31 has no `options.needs_memory_limit`.** On macOS, or on Linux without `prlimit`, the harness runs a 26-qubit execute uncapped. That is the allocation the audit saw blow up the box.
   - Its `xfail.current` (`error:simulation_error`, "dies with MemoryError") is an artefact of the harness's 8 GiB `RLIMIT_AS`. Uncapped, on a large host, the program may well succeed, which produces a `CorpusDrift` failure there.
   - The desired `execute: error:too_many_qubits` is also not deterministic under the master's R-11 policy (§5.1 R-B: estimated peak against `min(25 % of RAM, setting)`; "n=24 sampled run ok"). 2^26 × 16 B = 1 GiB per copy fits the budget on a 16 GiB-plus machine, so once R-B lands, q31 can legitimately run `ok`.
   - Fix:
     - Add `options: {needs_memory_limit: true}` to q31.
     - Make its desired outcome host-independent: either move the refusal check to g01 only and give q31 an `envs`/`note` saying the outcome depends on RAM, or assert only "ok or too_many_qubits" through a dedicated status set.
     - Record that the `current` block was observed under the harness's `RLIMIT_AS` cap.

## Minor

1. **`kernel/tests/_kernel_client.py:221`: the "reap children that outlived the leader" step is a no-op.** `_kill_group()` returns early when `proc.poll() is not None`, and by line 221 the leader has always been waited for. It would also fail on `os.getpgid` of a reaped pid. Children that ignore SIGTERM, or children of a leader that already died (os._exit, OOM, after which `KernelPool.get` calls `stop()`), are orphaned. `test_stop_kills_the_kernel_and_its_children` spawns no children, so it cannot catch this. Fix: store `pgid = proc.pid` at start (`start_new_session=True`), call `os.killpg(pgid, SIGKILL)` unconditionally, catch `ProcessLookupError`, and add a test with a child that ignores SIGTERM.
2. **`kernel/tests/_kernel_client.py:53/135`: the harness puts the kernel under `prlimit --as`.** Master §137 rules RLIMIT_AS out ("breaks numpy/BLAS and rustworkx", macOS rejects it). It is acceptable as a test-only backstop, but goldens recorded under it (q31, g01 `current`) describe a cap the app never has, and on high-core hosts the virtual reservations of BLAS and rayon threads can hit 8 GiB spuriously. Fix: document this in the README, or switch to RSS polling once R-B's `procrun` exists.
3. **`kernel/tests/research_corpus/gates/expected.yaml:25` (g03): the `current: {execute: timeout}` comes from the audit, not from an observation** (no Xvfb here). The report says so. CI's corpus-full and corpus-app-env install Xvfb, and setup-python ships tkinter, so CI is the first place this entry runs. A wrong ledger there turns into XPASS or `CorpusDrift` red. Check the first CI run.
4. **`expected.yaml:478` (r03): the desired `parse: error:execution_error` sits outside the xfail.** Once R-20 is fixed, parse should succeed too. The drift check will force an edit then, but the "desired" block currently encodes a bug as the target. Move parse into the xfail's `current` and set the desired value to `parse: ok`.
5. **`unbound_parameters` (expected.yaml:24 and q04/q10) is expected as an `error` frame, but master §240 calls it "info-class".** If R-A/R-B emit it as a non-`error` frame, `classify` will never produce `error:unbound_parameters`. The report raises this as a concern. Tell R-A/R-B, or let `classify` recognise an info code.
6. **`runner.py:327` (`KernelPool.get`):** when `kernel.start()` fails, the new `Kernel`'s runtime temp dir is never removed (`stop()` is never called). Wrap it in try/except and call `stop()` before re-raising.
7. **`_kernel_client.py:295`:** `frame_sizes` records `len(raw)` of a `str` (characters), not bytes, so the frame-size gates under-count non-ASCII output. Use `len(raw.encode())` when `raw` is a str.
8. **`runner.py:264`:** a trailing `error` frame that arrives more than 0.25 s / 0.1 s after `snapshot`/`result` is classified as `ok`. This is a latent flake under load. Consider waiting for an explicit end-of-phase marker if the protocol has one.
9. **`scripts/make-test-venvs.sh:153` installs pytest, pytest-cov and pyyaml into `app-env`, and uses `uv venv`.** The result is not "exactly what the shell installs", which `check-app-env.sh` does get right by keeping a separate runner venv. Either align the two, or document that the `make-test-venvs` app-env is approximate.
10. **`scripts/check-app-env.sh` `--catalog research` cannot pass:** the qk2 env probe (`runner.py:202`) requires stim to be absent. Either reject that combination with a clear message or relax the probe for check-app-env.
11. **Portability:** `mapfile` (check-app-env.sh:73, make-test-venvs.sh:150) and empty `"${ARR[@]}"` under `set -u` fail on macOS's stock bash 3.2. Since `.dmg` releases are built on macOS, note the requirement for bash 4 or later, or avoid `mapfile`.
12. **`loader.py:243/264`:** the mutable `_Entry` has its `spec` reassigned in place. The user's immutability rule prefers building a new mapping. This is trivial.
13. **TDD (binding constraint 3):** the report admits that the harness classes (loader, runner, client, ownership checker, about 1,300 lines) were written before their tests. RED evidence exists only for the golden. Hand-mutation evidence mitigates this. The controller should note the deviation.

## Cannot verify

- That the corpus result is "142 passed, 2 skipped, 31 xfailed" in all three envs (I did not re-run it).
- The CI workflow end to end (not run). The coverage gate's package list matches the master's new kernel dirs (surrogates, noise, qkernel, symmetry, deploy, qec/learned) by inspection only.
- That `src-tauri/target/release/kernel` is where the bundle puts the kernel (the default for `check-app-env.sh`).
- g03's real behaviour with a display.
