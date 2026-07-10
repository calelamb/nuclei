# Dirac Agentic Quantum Runtime — Implementation Plan (Fable takeover)

**Status:** in progress · branch `feat/dirac-agent-runtime` off `origin/main`
**Supersedes:** the PR #36 plans (kept as reference in `docs/superpowers/`, but NOT
authoritative — they were rewritten 21+ times mid-run to ratify a broken build and
contain hard contradictions). This document is the honest contract.

## What we are building

Dirac becomes a project-aware, agentic quantum coder. Given a goal it writes
framework-native code (Qiskit/Cirq/Q#), parses and simulates it locally, repairs its
own failures in a closed loop, plans a compatible backend, and — within explicit
budgets — submits to real quantum hardware and monitors the job. Deterministic Nuclei
services authorize and execute; Claude only proposes typed actions and never touches
credentials. This is the vision of the approved spec (`docs/superpowers/specs/...`),
delivered on a right-sized foundation.

## Why the pivot (what changed vs GPT-5.6's PR #37)

A verified 12-reviewer audit found GPT-5.6's ~26k lines delivered only Stage 0 (an
OS-level sandbox harness) and that it was largely dead-on-arrival:

- The 8k-line Rust sandbox can never activate on a real `.dmg` user's machine — by the
  plan's own text, production provisioning is disabled and qualification needs 8
  CI-only env vars.
- The macOS gate can never pass: the worker-spawn path calls `setrlimit(RLIMIT_AS)`
  with a finite value, which modern Darwin rejects with `EINVAL` (empirically confirmed
  on Darwin 25.5.0).
- The actual user-facing feature (closed-loop agent) was 0% built.
- Threat model inverted: OS-grade sandbox for model code while the kernel already
  `exec()`s user-typed code unsandboxed next to hardware credentials.
- Two CI walls (Kernel Tests red ~9.5h for a missing `cirq`; Linux cgroup OOM gate
  structurally unpassable).

**Decision (owner-approved): pivot to the vision, salvage the good parts, cut the
dead-code OS-sandbox machinery, build on right-sized subprocess isolation that ships.**

## Salvaged vs cut

KEEP (sound, self-contained, cross-platform):
- `kernel/agent_protocol.py` — strict wire contract for the isolated worker.
- `kernel/agent_limits.py` — resource limits (made cross-platform; see Stage 0).
- `kernel/agent_worker.py` — disposable one-request subprocess (stdin→stdout), import
  denylist, bounded output. This IS the right-sized isolation.
- `kernel/executor.py`, `kernel/adapters/qsharp_adapter.py` improvements.
- The kernel worker/protocol tests.

CUT (over-engineered / dead / unshippable):
- `src-tauri/src/agent_runtime/{macos,linux,resources,process,mod,protocol,unsupported}.rs`
  — Merkle runtime identity, generation leases, cgroup OOM proofs, disabled provisioning.
- `build.yml` isolation jobs, the impossible Linux OOM gate, the `=zip`/`=open` MSRV pins.

## Right-sized isolation model

Model-generated code that Dirac runs autonomously in its verify/repair loop executes
in `agent_worker.py`: a fresh Python subprocess with `resource` rlimits (CPU, address
space where supported, file size, nofile, nproc, no core), an import denylist covering
credentials + provider SDKs + `kernel.server`/`kernel.hardware`, and a bounded,
single-JSON response. No network use is needed by parse/simulate. This is proportionate
for a free educational IDE and works on macOS and Linux without kernel surgery.

## Stages

- **Stage 0 — Salvage & green pipeline.** Bring the kernel worker + tests; make
  `apply_worker_limits` cross-platform (macOS rejects finite `RLIMIT_AS`); install the
  agent frameworks in `kernel-tests.yml`. Gate: full kernel suite green locally + in CI.
- **Stage 1 — Closed-loop simulator agent.** Framework-neutral TS orchestrator with true
  multi-turn tool results; project manifest + reversible patch transactions; write →
  validate → simulate → bounded-repair loop; run journal; Dirac run-card UI. Wire the
  isolated worker as the execution path. Gate: prompt→verified-local-program works;
  frontend tests green.
- **Stage 2 — Quantum intelligence.** Quantum Program IR, semantic validators, resource
  estimation, ideal/noisy result comparison.
- **Stage 3 — Hardware planner (shadow).** Compatibility filtering, transpile preview,
  explainable scoring, recommendations — NO submission.
- **Stage 4 — Budgeted hardware autonomy.** Deterministic policy engine, atomic budget
  ledger, idempotent submission, durable job reattachment, monitoring/analysis. Built and
  tested against a fake provider. **Real-money autonomous submission ships behind an
  explicit, off-by-default setting** — flipping it on is a human decision, not an
  overnight one.

## Safety invariants (non-negotiable)

- Claude proposes typed actions; deterministic services authorize/execute.
- Credentials never enter model context; the model never invokes provider SDKs directly.
- All project mutations are conflict-detected, journaled, and reversible.
- Hardware is never submitted without deterministic compatibility + policy approval.
- Paid jobs are idempotent across retries/restarts; budgets cannot be exceeded.
- Nuclei remains a working local IDE when Claude is unavailable.
