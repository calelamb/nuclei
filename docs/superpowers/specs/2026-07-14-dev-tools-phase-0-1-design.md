# Developer tools — Phase 0 (editor quality) + Phase 1 (Transpiler Explorer)

**Status:** proposed · **Date:** 2026-07-14 · **Slice:** first of a phased developer-tools initiative

This is the first implementation slice of a larger developer-focused initiative
(Transpiler Explorer → Dirac dev-copilot → Quantum Debugger → editor depth). It
covers **Phase 0** (make the editor feel elite — bugs + responsiveness) and
**Phase 1** (the Transpiler Explorer). Later phases get their own specs.

Guiding architecture for the whole initiative: **each developer capability is one
kernel job with two front-ends** — a UI panel for humans and (later) a Dirac
agent tool. Phase 1 builds the `transpile` kernel capability; Phase 2 will expose
it to the agent with no new kernel work.

---

## Phase 0 — Editor quality

Goal: eliminate the felt bugs and jank so writing/editing/reading code feels like
a VS Code-class editor. Scoped to the **low-risk, high-value** fixes; the bigger
editor refactors (per-tab Monaco models, Python diagnostics, formatting, code
actions) are deferred to Phase 4 and noted at the end.

### P0.1 — Data-loss fix (dirty close from the Open Files sidebar)
`OpenFilesSection.tsx` calls `closeTab(tab.path)` directly, bypassing the
save-prompt guard the tab bar uses (`EditorTabs.requestClose` → unsaved-changes
dialog). Closing an unsaved buffer there **silently discards changes**.
- **Change:** route the sidebar's close (and any FileExplorer close of an open
  buffer) through the same `requestClose` path so the unsaved-changes dialog
  fires. Extract the guard into a shared helper if the two call sites diverge.
- **Test:** a store/interaction test that closing a dirty tab from the sidebar
  raises the pending-close dialog rather than dropping the buffer.

### P0.2 — Ghost completions: debounce, bound payload, stop provider-stacking
`ghostCompletions.ts` claims a 500ms debounce but has **none** — it fires on
every keystroke and POSTs the **entire file** to the model on the user's own API
key. And `registerGhostCompletions` is re-registered on every editor mount
(global provider, disposable ignored), multiplying calls.
- **Changes:**
  - Add a real trailing **debounce (~400ms)** around the fetch.
  - **Bound the payload** to a window around the cursor (e.g. N lines before /
    after) instead of `model.getValue()`.
  - Register the inline-completion provider **once** (module-level / guarded),
    honor the returned disposable, and `cancelCompletion()` on blur and on run.
  - Fix the comment/string guard to consider the cursor's position on the line,
    not just whether the *line* starts with a comment token.
- **Test:** unit-test the debounce + payload-windowing pure helpers (extract them
  so they're testable without Monaco).

### P0.3 — Cut editor render churn
`QuantumEditor` subscribes to the whole `editorStore` (re-renders on kernel
status, dirty, errors, …).
- **Change:** use selectors (`useEditorStore(s => s.code)`, etc.) so the editor
  subtree only re-renders on the fields it uses.

### P0.4 — Keep the editor mounted across the Research view toggle
Switching Research experiments/QEC view ↔ editor unmounts and remounts Monaco
(`PanelLayout` ternary), losing undo history, cursor, and scroll and re-running
mount setup.
- **Change:** keep the editor mounted and toggle visibility (CSS) instead of
  unmounting, or hoist it so the branch swap doesn't dispose it. Verify Monaco's
  `automaticLayout` still relayouts on show.

**Deferred to Phase 4 (called out so they're not forgotten):** per-tab Monaco
models (per-file undo/cursor/scroll — the biggest correctness gap, medium-risk
refactor), Python diagnostics via kernel `ruff`, formatting providers, wiring the
dead code-action provider, real inline-edit diff. These are their own spec.

---

## Phase 1 — Transpiler Explorer

Goal: a "godbolt.org for quantum" — take the circuit in the editor, transpile it
for a target, and **see** what the compiler did: before vs. after, pass by pass,
and why gates/SWAPs appeared. Qiskit-only (the only framework with an
introspectable compiler; the kernel already enforces this).

### P1.1 — Kernel: a `transpile` message

The kernel already has `Executor.transpile()` (Qiskit-only) but it's reachable
only via the Dirac agent path and returns **metrics only**. We promote it to a
first-class, additive WebSocket message that returns everything the panel needs.

- **Request** (additive, house style — new `elif` in `server.py:handle_message`,
  work off-thread via `asyncio.to_thread`):
  ```json
  {
    "type": "transpile",
    "code": "<python>",
    "basis_gates": ["rz","sx","x","ecr"],   // optional
    "coupling_map": [[0,1],[1,2], ...],       // optional
    "optimization_level": 2                    // 0–3, default 1
  }
  ```
  `basis_gates`/`coupling_map` are typically taken from a chosen `BackendInfo`
  (already plumbed to the frontend via `hardware_backends`).
- **Response** `transpile_result`:
  ```json
  {
    "type": "transpile_result",
    "before": <CircuitSnapshot>,   // extract_snapshot(original)
    "after":  <CircuitSnapshot>,   // extract_snapshot(transpiled)
    "metrics": { "depth": {"before":8,"after":21},
                 "two_qubit": {"before":4,"after":11},
                 "gate_count": {"before":12,"after":34} },
    "passes": [ { "name": "SabreSwap", "added_gates": {"swap": 6},
                  "depth_after": 17 }, ... ],
    "target": { "basis_gates":[...], "coupling_size": 27 }
  }
  ```
- **Implementation:** swap the top-level `qiskit.transpile()` for
  `generate_preset_pass_manager(...)` + a `PassManager` **callback** that
  captures the `DAGCircuit` + pass name after each pass; diff consecutive DAGs to
  attribute added gates (esp. SWAPs) per pass. Reuse `adapter.extract_snapshot`
  for before/after. Extend `GATE_NAME_MAP` so transpiled basis gates (`sx`, `rz`,
  `ecr`, `rzz`, …) render with real symbols instead of `NAME.upper()`.
- **Kernel tests:** known-answer on a small circuit for a fixed target — assert
  before/after depth+2q deltas, that a routing pass reports added SWAPs, and that
  a non-Qiskit framework returns the existing `transpile_unsupported_framework`.

### P1.2 — Frontend: the Transpiler Explorer panel

A new Research-mode panel (registered in `panelRegistry`, Research modes). It
renders non-live snapshots, so it uses the **prop-driven** circuit-diagram
pattern (`RunCircuitDiagram`), **not** the store-bound `CircuitRenderer`.

Layout:
```
┌─ Transpiler Explorer ───────────────────────────────────────────┐
│ Target [ ibm_torino ▼ ]   Opt [0][1][2][3]        [ Transpile ] │
├──────────────────────────────┬──────────────────────────────────┤
│ Before — logical             │ After — ibm_torino basis         │
│ [ circuit diagram ]          │ [ circuit diagram ]              │
│ depth 8 · 2q 4 · 12 gates    │ depth 21 · 2q 11 · 34 gates      │
│                              │      ↑ +13    ↑ +7     ↑ +22      │
├──────────────────────────────┴──────────────────────────────────┤
│ Compiler passes (12)                              Δdepth  Δgates │
│  1  UnitarySynthesis                                 0      0    │
│  …                                                              │
│  7  SabreSwap                          + 6 SWAPs    +6     +6  ● │  ← highlighted: it added the SWAPs
│  …                                                              │
├──────────────────────────────────────────────────────────────── │
│ Target coupling map [ConnectivityMap 27q]   basis {rz,sx,x,ecr} │
└──────────────────────────────────────────────────────────────────┘
```
- **Target selector** — populated from `hardwareStore` backends (their
  `connectivity` + `gate_set`); a "custom" option exposes raw basis/coupling +
  opt level. Sensible default: the simulator's all-to-all + opt level 1, or the
  first connected backend.
- **Before/after** — two `RunCircuitDiagram`-style diagrams fed the two
  snapshots; a metric strip under each with the before→after **delta** coloured
  (growth is expected, not "bad" — neutral/informational, not alarming).
- **Pass list** — each pass with its Δdepth / Δgates; the pass(es) that added
  entangling gates/SWAPs are visually emphasised (this is the "why did my circuit
  blow up" answer). Selecting a pass could later scrub the after-diagram to that
  pass's state (stretch; v1 shows the deltas + final).
- **Coupling map** — the target device topology via the existing
  `ConnectivityMap`, plus the basis-gate set, so the constraints that forced the
  routing are visible.
- **Empty / error states** — non-Qiskit circuit → a clear "Transpiler Explorer
  needs Qiskit" message (honest, matches the kernel constraint). No circuit /
  parse error → the reason, not a blank panel.

Design language: matches the QEC-panel treatment — `PanelHeader`, theme tokens,
`'Geist Sans'` / `'Geist Mono'`, semantic colour (the SWAP-adding pass uses the
accent, not error red — added gates are the *point* of routing, not a failure).

### P1.3 — Frontend plumbing
- `useKernel.ts`: add `case 'transpile_result'` to the dispatch → a small
  `transpileStore` (Zustand) holding the last result + pending flag.
- A `requestTranspile(code, target, optLevel)` sender alongside the existing
  `requestQecSnapshot` / decode senders.
- Pure helpers (layout of the pass list, delta computation, snapshot→diagram
  adaptation) extracted and unit-tested.

---

## Testing strategy

- **Kernel:** pytest known-answer for the `transpile` message (deltas, SWAP
  attribution, unsupported-framework path); the docs replay fixture pattern if we
  add it to a session doc.
- **Frontend:** unit tests for every pure helper (ghost-completion debounce +
  payload window; transpile delta/pass-list math; snapshot adaptation). Component
  tests for the panel's states (result, pending, unsupported-framework, no-DEM).
- **Editor:** interaction test for the data-loss guard; unit tests for the
  extracted ghost-completion helpers.
- All existing suites stay green (the 6 `installTelemetry` localStorage failures
  are the known baseline).

## Sequencing within this slice
1. Phase 0 fixes (independent, land first — fast, low-risk, visible).
2. Phase 1 kernel `transpile` message + tests.
3. Phase 1 panel + plumbing + tests.
4. Docs: protocol changelog + `messages-*` entry for `transpile`; a short
   Transpiler Explorer section in the research docs.

Likely 2–3 PRs (editor fixes; kernel transpile; explorer panel), each verified +
merged, matching the "spec each phase, then build" cadence.

## Non-goals (this slice)
- Any Dirac agent tool (Phase 2).
- The Quantum Debugger / per-step state (Phase 3).
- Per-tab Monaco models, Python LSP/diagnostics, formatting, code actions
  (Phase 4).
- Transpiler support for Cirq/CUDA-Q/Q# (not possible — no introspectable
  compiler; kernel already rejects them).
