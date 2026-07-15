# Developer tools — Phase 2: the Dirac dev-copilot layer

**Status:** proposed · **Date:** 2026-07-15 · **Slice:** second of the phased developer-tools initiative

Phase 1 shipped the Transpiler Explorer as a kernel capability with a human
front-end (the panel). Phase 2 makes good on the initiative's guiding
architecture — *each developer capability is one kernel job with two front-ends*
— by giving the **autonomous Dirac agent** the same capability, plus a
developer-grade persona so the agent behaves like a collaborator for
professionals rather than a tutor for beginners.

The whole point, in the user's words: *"if Dirac can do that agentically, I think
that's what would be killer. We have a full harness."* This phase turns the
existing harness (documented in [`dirac/agent-runtime.mdx`](../../docs-site/src/content/docs/dirac/agent-runtime.mdx))
into a **developer copilot**.

Reference for everything below: the agent runtime lives in
`src-tauri/src/dirac/`. This phase adds **one tool and one persona axis** — no
new *compilation* logic (Phase 1's `Executor.transpile_explore` already exists;
we only expose it to the agent's worker).

---

## Goals (this slice)

1. **A developer persona for the agent.** The agent's `SYSTEM_PROMPT` is a single
   fixed constant today (`orchestrator.rs:127-162`) — one voice for every run.
   Give it a persona axis so a Research-mode/developer run gets a terse,
   expert-peer voice (assume a professional; no hand-holding; lead with the
   answer) while the existing verify-first behavior is preserved as the default.
   This mirrors chat-Dirac's `diracPersona.ts` `personaPreamble(mode)`.

2. **A `transpile_explore` agent tool.** Give the agent the Transpiler Explorer's
   pass-by-pass data (not just the metrics-only `preview_backend_transpilation`
   it has today), so it can answer *"why did my circuit blow up on hardware"* and
   reason about routing/basis cost as a first-class capability, reusing Phase 1's
   `Executor.transpile_explore` with no new compilation code.

Nothing here enables autonomous hardware, changes the safety gates, or touches
chat-Dirac.

---

## P2.1 — Developer persona (parameterized system prompt)

### The change
Split the monolithic `SYSTEM_PROMPT` into a **persona preamble** + the shared
**operational rules** block (the tool-usage rules are identical across personas —
only the voice/framing differs). Add a `persona` axis threaded end-to-end.

- **Types** (`runner.rs`): add `persona: AgentPersona` to `RunConfig`
  (`runner.rs:44-52`). Enum `AgentPersona { Default, Developer }` (serde
  snake_case), defaulting to `Default` so existing callers/tests are unchanged.
- **Command** (`commands.rs`): `dirac_start_run` gains an optional `mode: String`
  arg (`commands.rs:93-157`); parse to the enum, default `Default` on
  absent/unknown (defensive, matching the kernel's boundary-validation house
  style). Thread into `RunConfig`.
- **Orchestrator** (`orchestrator.rs`): `run_agent` takes the persona (or reads it
  from a small config struct) and selects the preamble. Factor:
  ```
  const AGENT_RULES: &str = "…the existing Rules: block, verbatim…";
  fn persona_preamble(p: AgentPersona) -> &'static str { … }
  fn system_prompt(p: AgentPersona) -> String { format!("{}\n\n{}", persona_preamble(p), AGENT_RULES) }
  ```
  The **Default** preamble is today's text verbatim (byte-identical → the existing
  orchestrator tests stay green). The **Developer** preamble is terser and
  peer-level: *"You are Dirac, a quantum-computing pair-programmer for a
  professional developer. Be terse and precise. Lead with the change or the
  answer, then a one-line why. Don't explain quantum basics. Still never claim a
  result you haven't verified by simulation."* — the verify-first discipline and
  every safety rule are retained; only tone/altitude change.
- **Frontend** (`useDiracAgent.ts`): pass the current workspace mode
  (`useWorkspaceStore.mode`) → `mode: 'research' ? 'developer' : 'default'` in the
  `dirac_start_run` invoke (`useDiracAgent.ts:231-236`). Learn mode keeps the
  default voice; Research mode gets the developer voice.

### Why parameterize, not replace
The default persona is load-bearing for the current behavior and its tests. A
parameter (defaulting to Default) is additive and keeps the pure-core loop
tests untouched, while letting Research mode opt into the developer voice — the
same pattern chat-Dirac already uses per workspace mode.

### Tests
- Orchestrator unit test: a `Developer`-persona run produces a system prompt
  containing the developer preamble and the shared rules; a `Default` run is
  byte-identical to today. Scripted model + mock kernel (the existing harness).
- A parse/round-trip test for the `mode` arg (absent/unknown → `Default`).

---

## P2.2 — `transpile_explore` agent tool

Give the agent the Phase 1 explorer payload (before/after snapshots, metric
deltas, and pass-by-pass added-gate attribution). This is **analysis** — it never
edits code or submits anything, so it is a read-only tool.

### Recipe (the established add-a-tool path)
1. **Worker action** (`kernel/agent_worker.py`): add an
   `elif request.action == "transpile_explore":` branch that calls the
   already-existing `executor.transpile_explore(code, basis_gates=…,
   coupling_map=…, optimization_level=… or 1)` and returns its payload in the
   `result` field (`agent_worker.py:176-183` is the current `transpile` branch to
   mirror). This is the *only* Python change — no new compilation logic.
2. **Kernel port** (`kernel.rs`): add `AgentKernel::transpile_explore(&self, code,
   target) -> TranspileExploreOutcome` (mirror `transpile`, `kernel.rs:108`),
   building an `AgentExecuteRequest` with `action: "transpile_explore"`. New
   outcome enum `TranspileExploreOutcome::{ Ok(Value), Err(String) }` (the payload
   is opaque JSON forwarded to the model, so `Ok` carries a `serde_json::Value`).
3. **Tool schema** (`tools.rs`): add `transpile_explore` with optional
   `basis_gates` / `coupling_map` / `optimization_level` (same shape as the
   `transpile` kernel message), `additionalProperties: false`. Bump the count
   assertion **17 → 18** (`tools.rs:209`) and the order-asserting test
   (`tools.rs:222-249`).
4. **Dispatch** (`tool_exec.rs`): add the `"transpile_explore" =>` arm
   (`tool_exec.rs:202-236`) → `preview::exec_transpile_explore`.
5. **Executor** (`tool_exec/preview.rs`, alongside
   `exec_preview_backend_transpilation`): read the target from tool input, call
   `ctx.kernel.transpile_explore(...)`, return `ev_ok` with the payload as
   `facts` (or `ev_fail` on the Qiskit-only / no-circuit errors, surfaced as
   ordinary evidence — never a panic).
6. **System prompt** (both personas' shared `AGENT_RULES`): one sentence telling
   the agent it may call `transpile_explore` to see *what the compiler does pass
   by pass* for a target, distinct from `preview_backend_transpilation` (headline
   metrics) and `plan_hardware_run` (backend recommendation).

### Relationship to the existing tool
Keep `preview_backend_transpilation` (metrics-only; it feeds hardware planning
and the budget/policy story). `transpile_explore` is the richer analysis tool —
the agent picks the metrics tool when it only needs depth/2q numbers and the
explorer when it needs to *explain* the blow-up. Both are Qiskit-only and both
reuse the worker's transpile path.

### Tests
- Kernel/agent path: a pytest (or Rust integration via the real worker, like
  `test_transpile_preview.py`) asserting the `transpile_explore` action returns a
  payload with `passes` and metric deltas, and that a non-Qiskit framework
  returns the unsupported-framework error.
- Tool-dispatch unit test: `execute_tool("transpile_explore", …)` against a mock
  kernel returns `ok` evidence carrying `passes`; an unknown-tool guard still
  holds.
- Update `tools.rs` count/order tests.

---

## Non-goals (this slice, with rationale)

- **`optimize_circuit` (agent rewrites the file to the transpiled circuit).**
  Considered and deferred. A transpiled Qiskit circuit is device-basis gate soup;
  writing it back into the user's source (as regenerated Python or injected QASM)
  is low value — developers rarely want transpiled output *as their source* — and
  high complexity (round-tripping a `QuantumCircuit` to clean, framework-idiomatic
  code). The copilot's real leverage here is **analysis and guidance**
  (`transpile_explore`), plus the agent's existing `apply_patch` for edits it
  reasons out itself. Revisit only if a concrete workflow demands it.
- **Enabling autonomous hardware.** Untouched — off by default, policy gate and
  zero-spend ceiling unchanged. The developer persona explicitly keeps the
  "don't retry a needs-approval submit" rule.
- **The Quantum Debugger / per-step state** (Phase 3).
- **Any chat-Dirac change.** This phase is the *agent* runtime only.

---

## Testing strategy

- **Rust**: orchestrator persona test; tool dispatch + count/order tests; a
  worker-backed `transpile_explore` outcome test. All existing `dirac::` tests
  stay green (the Default persona is byte-identical; the new tool is additive).
- **Python**: a pytest for the new worker action (payload shape +
  unsupported-framework), mirroring `test_transpile_preview.py`.
- **Frontend**: `useDiracAgent` passes the workspace mode; a small unit check that
  Research → `developer`.
- Baselines unchanged (the 6 `installTelemetry` localStorage failures remain the
  known frontend baseline; kernel suite stays green).

## Docs

- Update [`dirac/agent-runtime.mdx`](../../docs-site/src/content/docs/dirac/agent-runtime.mdx):
  tool count 17 → 18, add `transpile_explore` to the tool table, and document the
  persona axis (the system prompt is no longer strictly fixed — it now varies on
  one axis: persona; the model id remains the other).
- A line in the protocol changelog if the worker protocol note warrants it (the
  new `transpile_explore` worker action is additive to `agent_protocol.py`).

## Sequencing

1. P2.1 persona (types → command → orchestrator split → frontend), with the
   byte-identical-default test landing first.
2. P2.2 tool (worker action → kernel port → schema+count → dispatch → executor →
   prompt sentence), then the worker-backed test.
3. Docs.

Likely **one PR** (the two pieces are small and cohesive; the persona split and
the tool both touch `orchestrator.rs`/`tools.rs`), verified green and merged per
the "spec each phase, then build" cadence.
