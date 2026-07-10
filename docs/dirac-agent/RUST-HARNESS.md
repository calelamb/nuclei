# Dirac Rust Agentic Harness — Architecture & Plan

**Status:** in progress · branch `feat/dirac-rust-harness` off `origin/main`
**Why:** The first cut (PRs #38–#39) built Dirac's agent loop in TypeScript + Python.
It works and shipped, but it puts the agent's **trusted runtime** — the model gateway,
execution supervisor, policy, budget, and orchestration loop — in the browser/JS layer,
where it is neither tamper-resistant nor able to hold credentials securely. The right
architecture for an elite, trustworthy quantum agent is a **Rust harness in the Tauri
shell** that owns the trusted runtime, with Python kept only for actual quantum execution
(qiskit/cirq/Q#) and React reduced to a thin observer/controller. This matches the spec's
own framing (§4.3 secure gateway, §16 "deterministic policy, credentials, execution, and
submission are trusted-runtime responsibilities, not model responsibilities").

## What runs where (the split)

| Layer | Owns |
|-------|------|
| **Rust harness** (`src-tauri/src/dirac/`) | Agent run **state machine + orchestration loop**; **secure model gateway** (Anthropic key in OS keychain, requests proxied from Rust); **execution supervisor** (spawns/limits/reaps the disposable Python worker); **deterministic policy engine**; **atomic budget ledger + idempotency**; workspace patch transactions; **quantum analysis** (resources, validators, algorithm invariants, comparison); **run journal + recovery**. Exposed via typed Tauri commands + `dirac://` events. |
| **Python kernel/worker** | Runs the actual quantum frameworks. Rust supervises `kernel/agent_worker.py` (already built) for isolated parse/simulate/transpile; the WS kernel keeps serving the editor. Quantum execution stays Python because that is where qiskit/cirq/qdk live. |
| **React/TS** | Thin: the run-card UI observes `dirac://run-event` and issues `dirac_*` commands. No orchestration loop, no API key, no policy in JS. The validated TS logic (analysis/policy/tools) is the reference being ported to Rust. |

Agent is desktop-only (already gated), so the Rust harness is THE runtime; no web fallback needed.

## "Fine-tuned & specified for quantum programming"

The harness is not a generic agent runtime. Its tool schemas, IR, validators, and policy
are quantum-domain: write/parse/validate/simulate/**compare-to-invariant**/estimate-resources/
**preview-transpilation**/plan-hardware/submit, with first-class notions of framework, qubits,
depth, two-qubit count, T-count, shots, noise, backend topology/basis, and algorithm invariants
(Bell/GHZ/teleport/…). The system prompt casts Dirac as a rigorous quantum physicist–programmer
that never asserts an unobserved result and verifies every claim by simulation.

## Modules (`src-tauri/src/dirac/`)

- `types.rs` — RunState machine, ToolCall/ToolEvidence, PatchTransaction, JournalEntry, ExperimentPlan, budgets (serde).
- `executor.rs` — **execution supervisor**: spawn `python -I agent_worker.py` in its own process group, feed the agent-protocol request, read the bounded response, enforce wall timeout + process-group kill. (Rust's domain; mirrors `KernelState`.)
- `gateway.rs` — **secure model gateway**: keychain-held Anthropic key (`keyring`), Anthropic Messages API via `reqwest`, tool_use/stop_reason parsing, size/rate/model limits, secret redaction.
- `workspace.rs` — project reads + reversible, hash-checked patch transactions, conflict detection, canonicalized to project root.
- `policy.rs` — deterministic policy engine (port of the TS engine; real-money OFF by default).
- `budget.rs` — atomic reserve/commit/release + idempotency (port).
- `analysis.rs` — resource estimation, validators, distribution comparison + TVD, algorithm classification/invariants (port).
- `orchestrator.rs` — the run loop tying the above together: model turn → tool calls → deterministic execution → evidence → next turn; budgets; journaling; recovery.
- `journal.rs` — append-only run journal + persistence + restart recovery.
- `commands.rs` — Tauri commands (`dirac_start_run`, `dirac_cancel_run`, `dirac_run_state`, `dirac_set_api_key`, `dirac_set_policy`, `dirac_execute`) + `dirac://run-event` emission.

## Stages (each compiles, tests, and CI-green before the next)

- **R1 — Execution supervisor + `dirac_execute` command.** Rust spawns the disposable worker, runs parse/simulate/transpile, timeout + process-group kill. Rust tests use a fake worker (no quantum stack needed). Add a real `cargo test`/`clippy` CI job — deliberately NO OS-sandbox qualification gates (those are what sank the previous Rust attempt).
- **R2 — Secure model gateway.** Keychain key storage + Anthropic client in Rust; injectable transport for tests.
- **R3 — Trusted-runtime cores.** Port policy, budget, workspace, analysis to Rust with tests.
- **R4 — Orchestrator + journal + recovery.** The state machine + loop + persistence; `dirac_start_run`/events.
- **R5 — Frontend rewire.** Run-card observes Rust events; `useDiracAgent` calls Tauri commands; thin the TS orchestrator.
- **R6 — Packaging + CI hardening.** Bundle the worker, cross-platform build, green pipeline.

## Non-negotiables (carried from the spec)

- The Anthropic key lives in the OS keychain and never reaches the frontend or model context.
- Policy/budget/execution are deterministic Rust the model cannot alter.
- All project mutations conflict-checked, journaled, reversible; real-money hardware OFF by default.
- No `RLIMIT_AS`/`RLIMIT_NPROC` blunt caps (they break the qiskit stack — see kernel/agent_limits.py); bound by CPU/wall + process-group kill.
- Nuclei remains a working IDE when the harness or Claude is unavailable.
