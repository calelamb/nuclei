# Developer tools — Phase 3: the Quantum Debugger

**Status:** proposed · **Date:** 2026-07-15 · **Slice:** third of the phased developer-tools initiative

Phases 1–2 gave developers a transpiler explorer and an agentic copilot. Phase 3
gives them the other half of an "elite editor" experience: a **debugger** — step
through a circuit gate by gate and *see the quantum state at each step* (Bloch
vectors + probabilities), the way a code debugger shows variables at each line.

**Key realization from the code map:** Nuclei already has the entire *cursor*
half of this — `circuitStore` holds `stepMode`/`stepIndex` with `stepNext`/
`stepPrev`, `CircuitRenderer`'s `StepControls` is a Prev/Next/Play/scrubber, Dirac
has a `step_to` tool, and the diagram already fades gates after the cursor. But
**it's visual-only — it never recomputes the quantum state.** Phase 3 is therefore
small and high-leverage: *add real per-step state behind the cursor that already
exists.* We elevate "step-through" (a highlight) into a "Quantum Debugger" (state
inspection) without rebuilding any of the navigation.

Qiskit + Cirq first (the two adapters with clean statevector + Bloch paths).
Q#/CUDA-Q/Stim get an honest "not yet" rather than a broken path.

---

## Design decisions (made, not open)

1. **Step granularity = per-gate**, indexing `snapshot.gates[k]` — because the
   existing cursor (`stepIndex`) already is a per-gate array index. Matching it
   means the scrubber, `step_to`, Play, and the context-menu "step from here" all
   drive the debugger with zero change. (Per-layer/moment was considered; per-gate
   is finer and already wired.)

2. **Eager whole-trajectory, computed once.** Rather than a kernel round-trip per
   step (janky scrubbing), one message returns the state after *every* step — an
   array of `G+1` states (initial `|0…0⟩` through final). The frontend caches it;
   the existing scrubber then indexes into it **instantly**, client-side. A gate
   cap keeps payloads bounded.

3. **Reuse the existing state panels.** When step mode is active, `BlochPanel` and
   the histogram show the state **at the cursor** instead of the final
   `simulationStore.result`. No new debugger panel — the same Bloch sphere and
   probability bars the user already reads, now scrubbing through time.

4. **Do not touch the Bloch order.** The qiskit reversal is already fixed
   (`qiskit_adapter.py:140`, regression test `test_adapter_bloch_order.py`). The
   per-step path **reuses each adapter's existing Bloch loop** verbatim, honoring
   its endianness — no new coordinate math.

---

## P3.1 — Kernel: a `debug_trace` message

A new additive WebSocket message that returns the per-step state trajectory.

- **Request** (mirrors the `transpile` message plumbing):
  ```json
  { "type": "debug_trace", "code": "<python>", "language": "python" }
  ```
- **Response** `debug_trace_result`:
  ```json
  {
    "type": "debug_trace_result",
    "data": {
      "framework": "qiskit",
      "qubit_count": 3,
      "steps": [
        { "gate_index": -1, "label": "initial",
          "state_vector": [...], "probabilities": {...}, "bloch_coords": [...] },
        { "gate_index": 0, "label": "H q0",
          "state_vector": [...], "probabilities": {...}, "bloch_coords": [...] },
        ...
      ]
    }
  }
  ```
  `steps[k]` is the state **after** applying gate `k` (`steps[0]` = the initial
  all-zero state; `gate_index: -1`). Each step's payload is a slim
  `SimulationResult` subset (`state_vector` + `probabilities` + `bloch_coords`) —
  the exact shape `BlochPanel`/histogram already consume. `label` is a short
  human string (gate type + targets) for the step readout.

- **Adapter method** `state_trace(circuit) -> list[StepState]` on the base
  adapter interface (`kernel/adapters/base.py`), implemented for qiskit and cirq:
  - **Qiskit:** incremental evolution — start `Statevector` in `|0…0⟩`, evolve one
    instruction at a time, and after each snapshot probabilities + Bloch (reusing
    the corrected `n-1-i` loop from `qiskit_adapter.simulate`). O(G·2ⁿ) total,
    not O(G²·2ⁿ). Skip non-unitary ops (measure/barrier) for the state, but still
    emit a step (state unchanged) so the cursor stays aligned with `gates`.
  - **Cirq:** build the prefix circuit of the first `k` operations and simulate
    (or use `simulate_moment_steps` and snapshot at operation boundaries),
    reusing the cirq Bloch loop (axis `i`, no flip).
  - Frameworks without a statevector path (Q#, CUDA-Q, Stim) → the executor
    returns a `debug_unsupported_framework` error, surfaced as a clear panel
    message.

- **Executor** `debug_trace(code, language)` — same setup as `execute`
  (resolve spec, run code, find circuit), then `adapter.state_trace(circuit)`.
  **Hard cap `MAX_DEBUG_GATES` (e.g. 200)**: beyond it, return a
  `circuit_too_large` error naming the limit (no silent truncation — house
  style). Off-thread in `server.py` like every heavy call.

- **Kernel tests:** known-answer on a Bell circuit — `steps[0]` is `|00⟩`
  (prob `00` = 1), the step after `H` puts `q0` on the X axis, the final step
  matches a full `execute`; a GHZ Bloch check; the qiskit-vs-cirq agreement on a
  shared circuit; the unsupported-framework and over-cap errors.

## P3.2 — Frontend: state behind the cursor

- **`debugStore`** (small Zustand slice, or a `trace` field on `circuitStore`):
  holds the fetched trajectory + a pending/error flag. Cleared when the snapshot
  changes (same trigger that resets `stepIndex`).
- **`debugTraceSender`** — a module-level sender registered by `useKernel`
  (identical pattern to `transpileSender`), plus a `debug_trace_result` dispatch
  case routing into `debugStore`.
- **Fetch trigger:** when the user *enters* step mode (`setStepMode(true)`), and
  re-fetch if the code changed while in step mode (debounced). Not on every
  keystroke otherwise — the trace is only needed while debugging.
- **Panel rewiring (the one visible change):** `BlochPanel` and the histogram
  read the **current step's** state when `stepMode` is on and a trace is loaded,
  falling back to `simulationStore.result` otherwise. `BlochPanel` gains an
  optional `blochCoords` prop with a store fallback (per the map, a small change;
  `ClassicBlochSphere` is already prop-driven). The step readout in
  `StepControls` gains the step's `label` and a "state at step k/N" line.
- **Empty/unsupported states:** non-Qiskit/Cirq circuit in step mode → the panels
  show "State stepping supports Qiskit and Cirq" rather than stale final-state
  data. Over the gate cap → the limit message.

- **Frontend tests:** pure helpers (selecting `trace[stepIndex]`, the fallback
  logic) unit-tested; a `debug_trace_result` dispatch test; a BlochPanel test for
  the prop-vs-store selection.

## P3.3 — Dirac & docs (light)

- **`step_to`** already moves the cursor; once the debugger exists it becomes
  genuinely useful (the agent can walk the user to the gate where the state goes
  wrong). No new tool needed this slice — but note it in the agent-runtime doc.
- **Docs:** a short "Quantum Debugger" page under Developer Tools (sibling to the
  Transpiler Explorer), and the `debug_trace` message in the kernel-API + protocol
  changelog.

---

## Non-goals (this slice)

- **Q#/CUDA-Q/Stim per-step state.** Q# is source-mode (no circuit object) and
  Stim is a stabilizer sampler (no statevector); honest "not yet" messages, not
  broken paths.
- **Mid-circuit measurement semantics** beyond what the statevector shows
  (collapse/classical-conditioned branches) — the trace is the pre-measurement
  statevector trajectory; measurements are shown as no-op steps in v1.
- **A separate debugger panel / variables view.** Reuse Bloch + histogram.
- **Breakpoints, watch expressions, reverse-execution.** The scrubber is the
  navigator; richer debugger UX is a later slice if it earns its keep.
- **Per-layer/moment stepping.** Per-gate chosen (matches the existing cursor).

## Testing strategy

- **Kernel:** pytest known-answer traces (Bell/GHZ), qiskit↔cirq agreement,
  unsupported-framework + over-cap errors, and `steps[final]` == a full `execute`.
  Reuse the Bloch-order regression fixtures.
- **Frontend:** pure-helper unit tests (step selection, fallback), dispatch test,
  BlochPanel prop/store test.
- Baselines unchanged (6 `installTelemetry` localStorage failures remain the
  known frontend baseline).

## Sequencing

1. Kernel `debug_trace` + adapter `state_trace` (qiskit, cirq) + tests.
2. Frontend store + sender + dispatch + panel rewiring + tests.
3. Docs (Developer Tools page + protocol changelog + kernel-API entry).

Likely **2 PRs** (kernel; frontend+docs), each verified green and merged per the
"spec each phase, then build" cadence. This is a smaller slice than Phase 1
because the entire navigation layer already exists — Phase 3 only adds the state.
