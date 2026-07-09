# Dirac Agentic Quantum Runtime

**Status:** approved design, pending written-spec review  
**Date:** 2026-07-09

## 1. Purpose

Dirac will evolve from a set of AI-assisted editor features into a project-aware quantum experiment agent. Given a user goal, it can write and edit a quantum program, validate and simulate it, repair failures, select a compatible quantum backend, submit within configured policy, monitor the job, and analyze the result.

The target experience is adaptive:

- Beginner-safe defaults for students progressing toward real hardware.
- A concise research mode for advanced experimentation.
- Autonomous operation within explicit budgets rather than per-action approval.
- Provider selection based on compatibility, expected result quality, queue, and cost.

The central safety rule is that Claude proposes typed actions while deterministic Nuclei services authorize and execute them. The model never receives provider credentials, mutates files outside a workspace transaction, bypasses policy, or invokes provider SDKs directly.

## 2. Current-state findings

Nuclei already contains most execution primitives, but they are not assembled into a closed-loop agent:

- `src/hooks/useDirac.ts` streams chat and executes tools, but does not continue the same model turn with tool results.
- Code generation is split across chat, compose, inline edit, ghost completion, and error rewrite paths.
- Dirac context is centered on the active editor buffer rather than the project.
- `insert_code` does not honor all declared cursor and selection semantics.
- `run_simulation` starts execution without returning the eventual result to the agent loop.
- Dirac's `submit_hardware` tool creates a local job record but does not use the kernel hardware submission path.
- Claude calls originate from frontend code and use a browser-access header.
- The Python kernel already implements Qiskit, Cirq, CUDA-Q, and Q# adapters.
- The hardware layer already has a provider abstraction and implementations for IBM, IonQ, AWS Braket, Azure Quantum, Quantinuum, NVIDIA simulators, and the local simulator. Google is a stub; Xanadu and D-Wave are UI placeholders.
- Hardware submission lacks a centralized compatibility, resource, cost, quota, and policy gate.
- Persisted jobs cannot reliably reattach to provider jobs after restart.
- Cross-framework hardware support varies by provider and cannot truthfully be treated as universally portable.

This design builds on the working kernel and provider boundaries instead of replacing them.

## 3. Scope

### In scope

- Project-wide inspection and transactional edits.
- A durable observe-plan-act-verify agent loop.
- Framework-native generation for Qiskit, Cirq, CUDA-Q, and Q#.
- Local parsing, semantic validation, simulation, testing, and bounded repair.
- A richer quantum analysis representation.
- Resource estimation and backend compatibility analysis.
- Provider-neutral hardware planning with provider-specific lowering.
- Configurable global, project, and per-run autonomy policies.
- Autonomous hardware submission when every applicable policy permits it.
- Durable monitoring, result analysis, provenance, and recovery.
- Beginner and research interaction modes.

### Non-goals

- Giving the model unrestricted shell, network, credential, or filesystem access.
- Claiming arbitrary source-to-source conversion between quantum frameworks.
- Enabling Google, Xanadu, or D-Wave hardware before their provider contracts are implemented and tested.
- Autonomous hardware execution in the browser build.
- Training a custom foundation model.
- Replacing framework compilers, transpilers, or provider SDKs with model judgment.
- Silently rewriting accepted source to match a backend.

## 4. Architectural boundaries

### 4.1 Agent Orchestrator

A framework-neutral TypeScript service, independent of React components and hooks, owns the run state machine. It:

- Builds bounded plans from a user goal.
- Requests typed tool calls from Claude.
- Executes authorized calls through Nuclei services.
- Returns structured tool evidence to the next model turn.
- Tracks token, iteration, time, job, shot, and monetary limits.
- Journals every state transition and recovers interrupted runs.
- Stops on completion, a deterministic terminal error, user cancellation, or a configured limit.

React observes the orchestrator and sends control commands; it does not own the loop.

### 4.2 Project Workspace Service

The workspace service presents a project manifest containing file metadata, framework hints, dependency files, dirty-buffer state, and content hashes. It supports:

- Scoped reads of relevant files.
- Structured patches with exact preconditions.
- File creation, rename, and dependency-file edits.
- Before/after hashes and reversible transactions.
- Conflict detection for unsaved or concurrently changed buffers.
- Atomic commit or rollback of an agent edit batch.

The service never allows paths outside the open project root. Ephemeral projects use an equivalent in-memory root.

### 4.3 Secure Local Gateway

The Tauri layer owns the Anthropic credential in the operating-system keychain and proxies model requests. It:

- Removes direct browser-to-Anthropic requests from desktop agent flows.
- Applies request size, model, token, and rate limits.
- Redacts secrets and sensitive environment values.
- Exposes only the tool schemas authorized for the current run.
- Records usage metadata without recording credentials.

Provider credentials remain in the existing kernel credential store and are never included in model context.

### 4.4 Quantum Execution Layer

The Python kernel remains the authority for:

- Framework detection and adapter loading.
- Source parsing and circuit extraction.
- Local simulation.
- Framework compiler and transpiler invocation.
- Provider connection, submission, polling, cancellation, and result retrieval.

It gains typed endpoints for semantic validation, resource estimation, backend-specific transpilation previews, cost estimates when supported, and durable provider-job reattachment.

### 4.5 Policy Engine

A deterministic policy engine receives a proposed action, workload facts, backend facts, budget ledger, and effective policy. It returns an allow, deny, or approval-required decision with reason codes. Model text cannot alter this result.

Effective policy is the intersection of:

1. Global ceiling.
2. Project allowance.
3. Per-run limits.
4. Provider and credential-profile restrictions.

## 5. Core data contracts

### 5.1 Experiment plan

Each agent run maintains an `ExperimentPlan` with:

- User goal and explicit success criteria.
- Framework and project constraints.
- Algorithm or experiment classification when recognized.
- Expected outcomes, observables, or invariants.
- Noise and precision assumptions.
- Planned edits and verification steps.
- Hardware requirements and selection objective.
- Effective autonomy policy and remaining budgets.
- Evidence produced by completed steps.

The plan is mutable through explicit revisions and persisted with the run journal.

### 5.2 Quantum Program IR

`CircuitSnapshot` remains the lightweight visualization contract. A separate Quantum Program IR supports deeper analysis:

- Quantum and classical registers with source locations.
- Gates, controls, targets, parameters, and symbolic bindings.
- Measurement mapping and endianness.
- Reset and mid-circuit measurement.
- Classical conditions and supported control-flow constructs.
- Observables and expected result forms.
- Dynamic-circuit and backend capability requirements.
- Source framework and lossless source references.
- Analysis facts such as depth, two-qubit count, ancillas, and T-count where meaningful.

The IR is an analysis and planning representation, not a promise of lossless translation. Provider lowering remains framework- and provider-specific.

### 5.3 Hardware plan

A `HardwarePlan` records:

- Workload and immutable source revision.
- Candidate backends and rejection reasons.
- Backend-specific transpilation metrics.
- Queue, calibration, availability, and cost observations with timestamps.
- Hard compatibility decisions.
- Scoring inputs, weights, and selected backend.
- Worst-case budget reservation.
- Submission idempotency key.
- Provider job identifier and lifecycle.

### 5.4 Agent evidence

Every tool result is structured evidence with:

- Tool and schema version.
- Run and step identifiers.
- Inputs after secret redaction.
- Start/end timestamps.
- Output facts and artifact references.
- Diagnostics and terminal status.

Claude receives only the evidence needed for the next decision.

## 6. Typed agent capabilities

Initial tools are intentionally narrow:

- `inspect_project`
- `read_quantum_file`
- `propose_patch`
- `apply_patch_transaction`
- `rollback_patch_transaction`
- `check_dependencies`
- `parse_quantum_program`
- `validate_quantum_program`
- `run_simulation`
- `compare_quantum_results`
- `estimate_quantum_resources`
- `preview_backend_transpilation`
- `plan_hardware_run`
- `reserve_hardware_budget`
- `submit_hardware_job`
- `poll_hardware_job`
- `cancel_hardware_job`
- `analyze_hardware_result`
- `write_experiment_report`

Tool schemas use discriminated unions and reject unknown fields. Read, reversible mutation, local execution, and paid/irreversible actions are separate capability classes. The runtime exposes only tools valid for the current state.

## 7. End-to-end run flow

### 7.1 Understand

Dirac converts the prompt into explicit goals: algorithm, expected result, framework preference, qubits, precision, noise assumptions, and hardware constraints. It asks a question only when a missing choice materially affects correctness, safety, or cost.

### 7.2 Build

Dirac inspects relevant project files and dependency manifests, then produces a small task graph. It writes framework-native source, tests, configuration, and experiment metadata through workspace transactions.

### 7.3 Verify locally

The runtime performs:

- Syntax, type, and language-service checks.
- Circuit extraction and semantic linting.
- Seeded or deterministic simulation where possible.
- Assertions for probabilities, observables, normalization, and algorithm invariants.
- Noise simulation when relevant to the hardware objective.
- Bounded automatic repair using structured diagnostics.

Failure to meet the success criteria within the iteration limit ends the run before hardware planning.

### 7.4 Prepare hardware

The planner:

1. Derives hard workload requirements from source and the Quantum Program IR.
2. Filters incompatible providers and backends.
3. Performs backend-specific transpilation previews.
4. Collects capacity, topology, basis, dynamic-circuit support, queue, calibration, availability, and cost facts.
5. Refuses conversion when semantic preservation cannot be established.
6. Ranks the remaining candidates.

### 7.5 Select and submit

Hard compatibility filters always precede scoring. Default scoring considers:

- Estimated result fidelity or success.
- Post-transpile depth and two-qubit gate count.
- Queue duration.
- Monetary cost.
- Calibration freshness.
- Region and provider preferences.
- Historical Nuclei performance for comparable workloads.

The score is configurable, recorded, and explainable. The selected run proceeds only after policy permits it and budget reservation succeeds.

### 7.6 Observe and analyze

Monitoring persists independently of the chat panel. On completion, Dirac compares hardware output with ideal and noisy simulations, computes suitable distribution or observable error metrics, reports confidence intervals, and identifies plausible noise or compilation causes without overstating certainty.

A mitigated rerun is a new planned action and must pass the remaining policy and budget checks.

### 7.7 Deliver

The run saves:

- Accepted source and tests.
- Environment and dependency metadata.
- Simulation seeds and results.
- Backend observations and transpilation artifacts.
- Policy decision and budget ledger.
- Provider job identifiers and normalized results.
- Analysis and a human-readable experiment report.

## 8. Quantum-specific reasoning

Dirac's validators and prompts support:

- Gate arity, control/target, register, parameter, and measurement correctness.
- Endianness and classical-bit mapping.
- Entanglement, phase, basis, and reset diagnostics.
- Algorithm-aware invariants for common educational and research patterns.
- Qubit, ancilla, depth, two-qubit, parameter, and selected fault-tolerant resource metrics.
- Safe candidate optimizations such as inverse cancellation, rotation merging, layout alternatives, and SWAP reduction.
- Shot selection from requested uncertainty when the result form permits it.
- Parameter sweeps and ideal/noisy/hardware baselines.
- Result comparison using metrics appropriate to counts, probabilities, observables, or state data.

Optimizations are proposed and benchmarked as variants. They do not silently overwrite the user's accepted source.

## 9. Autonomous hardware policy

Configurable controls include:

- Provider, backend, and credential-profile allowlists.
- Simulator versus QPU permissions.
- Global, project, and per-run spend limits.
- Shot, job-count, qubit, circuit-depth, and wall-clock limits.
- Maximum queue duration and retry count.
- Region restrictions.
- Calibration freshness and minimum quality thresholds.
- Behavior when cost cannot be estimated: deny, request approval, or reserve a configured worst case.

### Budget protocol

1. Reserve the estimated worst-case cost atomically.
2. Recheck backend state and policy immediately before submission.
3. Journal the intent and idempotency key before the provider call.
4. Submit once.
5. Persist the provider job identifier.
6. Reconcile the reservation with actual cost when available.

Lost connectivity never causes blind resubmission. If submission outcome is ambiguous, the run enters reconciliation and cannot spend again until the provider state or a user decision resolves it.

## 10. Run state and recovery

The primary states are:

`planning → editing → validating → simulating → hardware_planning → reserved → submitted → monitoring → analyzing → completed`

Terminal or interrupting states include:

- `needs_input`
- `needs_approval`
- `paused`
- `cancelled`
- `failed`
- `reconciling`

Each transition has explicit allowed predecessors. A restart reconstructs the run from the journal, verifies file hashes and provider state, and resumes only from a safe checkpoint.

Provider implementations must support lookup or reattachment by persisted job identifier before they are eligible for autonomous paid execution.

## 11. Security and failure behavior

- Generated programs run in a restricted subprocess with time, memory, network, and filesystem boundaries.
- Project text, diagnostics, tool output, provider metadata, and retrieved documentation are untrusted data, never control instructions.
- Model tool arguments are schema-validated and capability-checked.
- Workspace paths are canonicalized and constrained to the project root.
- Authentication and authorization failures stop without speculative remediation.
- Transient failures use bounded retries with exponential backoff.
- Retry logic distinguishes safe reads from potentially paid submissions.
- Audit records redact credentials, API keys, access tokens, and sensitive environment values.
- Emergency stop halts planning and future calls but accurately reports whether an already submitted provider job can be cancelled.
- Failed runs preserve diagnostics and useful artifacts with a specific terminal reason.

Nuclei remains a functioning local quantum IDE when Claude is unavailable.

## 12. Adaptive experience

### Beginner mode

- Explains the experiment goal, gates, expected outcomes, verification evidence, and backend decision.
- Uses conservative budgets and simulator-first defaults.
- Visualizes progress and translates failures into learning-oriented explanations.
- Avoids optimizations that obscure the student's program.

### Research mode

- Accepts precise experiment specifications and parameter sweeps.
- Shows concise plans, diffs, metrics, provenance, and policy decisions.
- Supports custom backend scoring and policy profiles.
- Produces machine-readable artifacts suitable for notebooks and pipelines.

Both modes use the same policy and execution boundaries. Skill adaptation can use consented project activity, but inferred skill never expands autonomy.

### Agent control surface

The UI exposes:

- Current plan and state.
- Pending and applied patch transactions.
- Validation and simulation evidence.
- Candidate backend comparison and selection rationale.
- Effective limits, reservations, and actual consumption.
- Provider jobs and reconnect status.
- Pause, resume, stop, rollback, and fork controls.

## 13. Testing strategy

### Unit tests

- Agent state transitions and stopping conditions.
- Tool schema validation and capability exposure.
- Workspace transaction preconditions, conflicts, commit, and rollback.
- Effective-policy intersection and deny precedence.
- Atomic budget reserve, release, and reconciliation.
- Backend filters and deterministic scoring.
- Quantum Program IR construction and semantic validators.

### Golden quantum corpus

Maintain correct and intentionally broken programs for Qiskit, Cirq, CUDA-Q, and Q#. Cover:

- Bell and GHZ states.
- Teleportation.
- Grover search.
- QFT and phase-sensitive failures.
- Variational circuits and parameter binding.
- Measurement mapping and endianness.
- Reset, conditions, and dynamic circuits where supported.
- Framework- and provider-specific unsupported constructs.

Golden tests verify diagnostics, invariants, resource facts, and semantic equivalence of explicitly supported lowering paths.

### Provider contracts

Each provider must pass mocked contracts for:

- Credential and connection failures.
- Backend discovery and capability normalization.
- Cost-estimate presence and absence.
- Transpilation compatibility.
- Successful submission.
- Timeout before and after provider acceptance.
- Duplicate-call prevention.
- Poll, result normalization, cancellation, and unsupported cancellation.
- Process restart and job reattachment.

### End-to-end and fault injection

- Prompt to project edits to local simulation to report.
- Prompt to shadow hardware plan.
- Budgeted submission against a fake provider.
- Network loss at every submission boundary.
- Kernel, app, and machine restart during monitoring.
- Concurrent budget reservations.
- User edits conflicting with an active transaction.
- Prompt injection embedded in project files and provider metadata.

Live QPU smoke tests are opt-in, tightly budgeted, and never required for the default suite.

## 14. Delivery sequence

### Stage 1: Closed-loop simulator agent

- Extract orchestration from `useDirac`.
- Add true multi-turn tool results.
- Add project manifests and patch transactions.
- Support write, validate, simulate, inspect, and bounded repair.

### Stage 2: Quantum intelligence

- Add the Quantum Program IR.
- Add semantic validators, resource estimates, generated assertions, algorithm invariants, and noisy-result comparison.
- Establish the multi-framework golden corpus.

### Stage 3: Hardware planner in shadow mode

- Add compatibility filtering, transpilation previews, cost/queue/calibration observations, and explainable scoring.
- Make recommendations without submission.

### Stage 4: Budgeted IBM autonomy

- Add layered policy, atomic reservations, idempotent submission, durable job reattachment, and analysis.
- Replace Dirac's local fake hardware tool with the real pipeline.

### Stage 5: Provider expansion

- Admit each implemented provider to autonomous operation only after its provider contracts and required framework-lowering paths pass.
- Keep unsupported combinations explicitly unavailable.

### Stage 6: Advanced experiments

- Add parameter sweeps, variational loops, mitigation comparisons, historical backend performance, and policy-bounded adaptive reruns.

## 15. Success criteria

- Dirac can complete a prompt-to-verified-local-program run across all four supported frameworks.
- Tool outcomes feed the same agent run until a terminal state.
- All project mutations are conflict-detected, auditable, and reversible.
- Hardware is never submitted without deterministic compatibility and policy approval.
- Paid jobs are not duplicated across retries or restarts.
- Budget consumption cannot exceed the effective configured ceiling through concurrent runs.
- Submitted jobs recover and continue monitoring after application and kernel restarts.
- Backend recommendations include reproducible evidence and calibrated uncertainty.
- Experiment artifacts are sufficient to reproduce source, environment, simulation, transpilation, submission, and analysis.
- Beginner and research modes differ in presentation and defaults, not in safety guarantees.

## 16. Locked design decisions

- Use a local agent runtime rather than extending React chat orchestration or embedding planning in the Python kernel.
- Optimize for the complete prompt-to-hardware-to-analysis lifecycle.
- Permit full autonomy only inside configurable layered budgets.
- Target adaptive beginner and research experiences.
- Operate on the entire open project.
- Pursue automatic provider choice while retaining provider-specific compatibility and lowering.
- Keep `CircuitSnapshot` and add a richer analysis IR.
- Start autonomous paid execution with IBM behind provider-neutral interfaces.
- Treat deterministic policy, credentials, execution, and submission as trusted-runtime responsibilities rather than model responsibilities.
