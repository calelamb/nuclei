import type { SubmissionFacts } from './policy';

// ---------------------------------------------------------------------------
// Cost estimator for submit_hardware_job. Simulator jobs are free; real QPU
// pricing is provider- and backend-specific and is not modeled yet, so it
// comes back as `null` (unknown). evaluateSubmission's `costUnknownBehavior`
// governs what an unknown cost means for a submission — under DEFAULT_POLICY
// that's `needs_approval`, which is moot anyway because
// `autonomousHardwareEnabled` already gates every real-QPU submission to
// `needs_approval` first. Pure, deterministic, never throws.
// ---------------------------------------------------------------------------

export function estimateSubmissionCost(facts: SubmissionFacts): number | null {
  return facts.isSimulator ? 0 : null;
}
