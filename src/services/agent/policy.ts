// ---------------------------------------------------------------------------
// Pure, deterministic autonomy policy for hardware submission. This is the
// safety boundary for Dirac's agent runtime: it decides whether a proposed
// job (simulator or real QPU) may be submitted, independent of anything the
// model said. No I/O, no randomness, never throws.
//
// The default policy is SAFE: autonomous hardware submission is OFF. A real
// QPU submission under DEFAULT_POLICY always comes back `needs_approval`,
// regardless of every other field — see evaluateSubmission below.
// ---------------------------------------------------------------------------

export type CostUnknownBehavior = 'deny' | 'needs_approval' | 'reserve';

export interface AutonomyPolicy {
  /** Master switch for autonomous REAL hardware submission. When false, every
   * real-QPU submission returns `needs_approval` regardless of any other
   * field on this policy. Simulator submissions are governed separately by
   * `allowSimulator` and are unaffected by this flag. */
  autonomousHardwareEnabled: boolean;
  allowSimulator: boolean;
  allowQpu: boolean;
  /** Empty array means "no allowlist restriction" (any provider passes this
   * check); a non-empty array restricts to exactly those provider ids. */
  providerAllowlist: string[];
  maxSpend: number;
  maxShots: number;
  maxQubits: number;
  maxCircuitDepth: number;
  costUnknownBehavior: CostUnknownBehavior;
}

/** SAFE default: no autonomous real-hardware submission, simulator only. */
export const DEFAULT_POLICY: AutonomyPolicy = {
  autonomousHardwareEnabled: false,
  allowSimulator: true,
  allowQpu: false,
  providerAllowlist: [],
  maxSpend: 0,
  maxShots: 4096,
  maxQubits: 32,
  maxCircuitDepth: 1000,
  costUnknownBehavior: 'needs_approval',
};

export interface SubmissionFacts {
  provider: string;
  backend: string;
  shots: number;
  qubits: number;
  depth: number;
  isSimulator: boolean;
  /** null means the cost could not be estimated; governed by
   * `costUnknownBehavior`. */
  estimatedCost: number | null;
}

export type PolicyDecisionKind = 'allow' | 'deny' | 'needs_approval';

export interface PolicyDecision {
  decision: PolicyDecisionKind;
  reasons: string[];
}

/**
 * Evaluates whether a proposed submission is allowed under `policy`, given
 * `remainingBudget` (the ledger's currently unreserved/unspent headroom).
 *
 * Rules (deterministic, independent of any model text):
 *  - Simulator path: allowed iff `policy.allowSimulator`.
 *  - Real hardware path: `!policy.autonomousHardwareEnabled` dominates and
 *    always returns `needs_approval`, before any other check runs. If
 *    autonomous hardware submission IS enabled, every remaining check
 *    (allowQpu, provider allowlist, shots/qubits/depth ceilings, cost vs
 *    maxSpend/remainingBudget) is evaluated and every failing check
 *    contributes its own reason; any failure denies the submission. A
 *    submission is `allow` only when every check passes.
 */
export function evaluateSubmission(
  facts: SubmissionFacts,
  policy: AutonomyPolicy,
  remainingBudget: number,
): PolicyDecision {
  if (facts.isSimulator) {
    return policy.allowSimulator
      ? { decision: 'allow', reasons: [] }
      : { decision: 'deny', reasons: ['Simulator submissions are disabled by policy.'] };
  }

  if (!policy.autonomousHardwareEnabled) {
    return {
      decision: 'needs_approval',
      reasons: ['Autonomous hardware submission is disabled. Enable it in Settings to allow paid jobs.'],
    };
  }

  const denyReasons: string[] = [];

  if (!policy.allowQpu) {
    denyReasons.push('QPU submissions are disabled by policy.');
  }
  if (policy.providerAllowlist.length > 0 && !policy.providerAllowlist.includes(facts.provider)) {
    denyReasons.push(`Provider "${facts.provider}" is not in the allowlist.`);
  }
  if (facts.shots > policy.maxShots) {
    denyReasons.push(`Requested shots (${facts.shots}) exceed the policy maximum (${policy.maxShots}).`);
  }
  if (facts.qubits > policy.maxQubits) {
    denyReasons.push(`Circuit qubit count (${facts.qubits}) exceeds the policy maximum (${policy.maxQubits}).`);
  }
  if (facts.depth > policy.maxCircuitDepth) {
    denyReasons.push(`Circuit depth (${facts.depth}) exceeds the policy maximum (${policy.maxCircuitDepth}).`);
  }

  let costNeedsApproval = false;
  if (facts.estimatedCost === null) {
    if (policy.costUnknownBehavior === 'deny') {
      denyReasons.push('Estimated cost is unknown and policy denies unknown-cost submissions.');
    } else if (policy.costUnknownBehavior === 'needs_approval') {
      costNeedsApproval = true;
    }
    // 'reserve': cost-unknown is treated as allowable, provided every other
    // check above passed — the caller is expected to reserve a placeholder
    // budget amount before actually submitting.
  } else {
    if (facts.estimatedCost > policy.maxSpend) {
      denyReasons.push(
        `Estimated cost (${facts.estimatedCost}) exceeds the per-job spend limit (${policy.maxSpend}).`,
      );
    }
    if (facts.estimatedCost > remainingBudget) {
      denyReasons.push(
        `Estimated cost (${facts.estimatedCost}) exceeds the remaining budget (${remainingBudget}).`,
      );
    }
  }

  if (denyReasons.length > 0) {
    return { decision: 'deny', reasons: denyReasons };
  }

  if (costNeedsApproval) {
    return {
      decision: 'needs_approval',
      reasons: ['Estimated cost is unknown; human approval is required before submission.'],
    };
  }

  return { decision: 'allow', reasons: [] };
}
