import type { BackendInfo } from '../../types/hardware';
import type { CircuitSnapshot, Framework, SimulationResult } from '../../types/quantum';
import type { BudgetLedger } from './budgetLedger';
import type { KernelPort, WorkspacePort } from './interfaces';
import type { AutonomyPolicy, SubmissionFacts } from './policy';
import type { SubmitPort } from './submitPort';

// ---------------------------------------------------------------------------
// ToolContext: the dependency bag every tool executor (local-simulation and
// hardware-submission alike) is invoked with. Kept in its own module so
// toolExecutors.ts and hardwareSubmitExecutors.ts can both depend on the
// type without creating a circular runtime import between them.
// ---------------------------------------------------------------------------

/** Resolves which framework a path's contents should be interpreted as.
 * Falls back to inspecting the workspace file when present; callers that
 * need a different strategy (e.g. inferring from a not-yet-created path's
 * extension) can supply their own resolver. */
export type FrameworkResolver = (path: string) => Framework;

export function defaultFrameworkResolver(workspace: WorkspacePort): FrameworkResolver {
  return (path: string) => {
    const file = workspace.readFile(path);
    if (file) return file.framework;
    return path.endsWith('.qs') ? 'qsharp' : 'qiskit';
  };
}

export interface ToolContext {
  workspace: WorkspacePort;
  kernel: KernelPort;
  /** Mutable slot holding the most recent simulation result, so
   * compare_quantum_results can reference it without threading it through
   * every tool call explicitly. */
  lastSim: { result?: SimulationResult };
  /** Optional mutable slot holding the most recently parsed circuit
   * snapshot, populated by parse_quantum_program, validate_quantum_program,
   * estimate_quantum_resources, and plan_hardware_run. submit_hardware_job
   * reuses it when present instead of re-parsing; otherwise it falls back to
   * a fresh parse of the active file. */
  lastSnapshot?: { snapshot?: CircuitSnapshot };
  resolveFramework: FrameworkResolver;
  /** Per-path hash the orchestrator last observed, used as the
   * conflict-check baseline for apply_patch. Updated on every successful
   * patch. */
  lastKnownHash: Map<string, string>;
  /** Optional accessor for the currently known hardware backends, used by
   * plan_hardware_run and submit_hardware_job. Undefined/omitted (or an
   * empty list) means no connected hardware — a normal state, not an
   * error. */
  getBackends?: () => BackendInfo[];
  /** Optional hardware submission channel. Omitted means hardware
   * submission is entirely unavailable — submit/poll/cancel/analyze tools
   * degrade to an "unavailable" evidence result rather than erroring. */
  submitPort?: SubmitPort;
  /** Autonomy policy gating submit_hardware_job. Defaults to DEFAULT_POLICY
   * (autonomous real-hardware submission OFF) when omitted — see policy.ts.
   * THIS IS THE SAFETY BOUNDARY: a real-QPU submission is never sent to
   * submitPort unless evaluateSubmission returns `allow`. */
  policy?: AutonomyPolicy;
  /** Optional spend ledger used to reserve/commit/release budget around a
   * submission and to enforce submission idempotency. Omitted means no
   * budget tracking or idempotency de-duplication is performed. */
  ledger?: BudgetLedger;
  /** Optional cost estimator; returns null when the cost cannot be
   * determined. Defaults to a function that always returns null. */
  estimateCost?: (facts: SubmissionFacts) => number | null;
}
