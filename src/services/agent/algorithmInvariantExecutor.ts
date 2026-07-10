import type { AlgorithmKind } from './algorithms';
import { classifyAlgorithm, expectedDistribution } from './algorithms';
import { compareDistributions } from './analysis';
import type { ToolContext } from './toolContext';
import { asNumber, asString, fail, ok } from './toolHelpers';
import type { ToolEvidence } from './types';

// ---------------------------------------------------------------------------
// check_algorithm_invariant executor. Split out of toolExecutors.ts to keep
// that module under the file-size budget — this mirrors the
// hardwareSubmitExecutors.ts split for the same reason. Never throws:
// malformed input or a missing prerequisite always resolves to a structured
// evidence result (ok:true with checked:false, or ok:false for bad input).
// ---------------------------------------------------------------------------

const DEFAULT_INVARIANT_TOLERANCE = 0.1;
const ALGORITHM_KINDS: AlgorithmKind[] = ['bell', 'ghz', 'uniform_superposition', 'teleportation', 'unknown'];

function isAlgorithmKind(value: string): value is AlgorithmKind {
  return (ALGORITHM_KINDS as string[]).includes(value);
}

export function execCheckAlgorithmInvariant(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): ToolEvidence {
  const algorithmInput = input.algorithm === undefined ? null : asString(input.algorithm);
  if (input.algorithm !== undefined && algorithmInput === null) {
    return fail('check_algorithm_invariant', toolCallId, 'If provided, "algorithm" must be a string.');
  }
  if (algorithmInput !== null && !isAlgorithmKind(algorithmInput)) {
    return fail(
      'check_algorithm_invariant',
      toolCallId,
      `If provided, "algorithm" must be one of: ${ALGORITHM_KINDS.join(', ')}.`,
    );
  }

  const toleranceInput = input.tolerance === undefined ? null : asNumber(input.tolerance);
  if (input.tolerance !== undefined && toleranceInput === null) {
    return fail('check_algorithm_invariant', toolCallId, 'If provided, "tolerance" must be a number.');
  }
  const tolerance = toleranceInput ?? DEFAULT_INVARIANT_TOLERANCE;

  const sim = ctx.lastSim.result;
  if (!sim) {
    return ok('check_algorithm_invariant', toolCallId, {
      checked: false,
      reason: 'Run a simulation first, then check the invariant.',
    });
  }

  const snapshot = ctx.lastSnapshot?.snapshot;
  const algorithm: AlgorithmKind = algorithmInput ?? (snapshot ? classifyAlgorithm(snapshot).algorithm : 'unknown');
  const qubitCount = snapshot?.qubit_count ?? Object.keys(sim.probabilities)[0]?.length ?? 0;

  const expected = expectedDistribution(algorithm, qubitCount);
  if (!expected) {
    return ok('check_algorithm_invariant', toolCallId, {
      checked: false,
      algorithm,
      reason:
        'No fixed reference distribution for this algorithm; compare against your own expected_probabilities instead.',
    });
  }

  const report = compareDistributions(sim.probabilities, expected, tolerance);

  return ok('check_algorithm_invariant', toolCallId, {
    checked: true,
    algorithm,
    matches: report.matches,
    totalVariationDistance: report.totalVariationDistance,
    worstDelta: report.worstDelta,
    expected,
    note: `Compared against the known ${algorithm} reference distribution.`,
  });
}
