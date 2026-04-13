import type { TestCase, TestCaseResult } from '../types/challenge';
import type { SimulationResult } from '../types/quantum';

export function validateTestCase(
  testCase: TestCase,
  result: SimulationResult,
  executionTimeMs: number,
): TestCaseResult {
  const validation = testCase.validation;

  if (validation.type === 'probability_match') {
    const { passed, score, message } = validateProbabilityMatch(
      result.probabilities,
      validation.expected,
      validation.tolerance,
    );
    return {
      testCaseId: testCase.id,
      passed,
      score: score * testCase.weight,
      verdict: passed ? 'accepted' : 'wrong_answer',
      actualOutput: result.probabilities,
      message,
      executionTimeMs,
    };
  }

  if (validation.type === 'metric' && validation.metric === 'approximation_ratio') {
    const { passed, score, message } = validateApproximationRatio(
      result.measurements,
      testCase.params,
      validation.optimal,
      validation.threshold,
    );
    return {
      testCaseId: testCase.id,
      passed,
      score: score * testCase.weight,
      verdict: passed ? 'accepted' : 'wrong_answer',
      actualOutput: result.measurements,
      message,
      executionTimeMs,
    };
  }

  return {
    testCaseId: testCase.id,
    passed: false,
    score: 0,
    verdict: 'runtime_error',
    message: `Unknown validation type: ${(validation as { type: string }).type}`,
    executionTimeMs,
  };
}

function validateProbabilityMatch(
  actual: Record<string, number>,
  expected: Record<string, number>,
  tolerance: number,
): { passed: boolean; score: number; message: string } {
  const mismatches: string[] = [];
  let totalError = 0;

  for (const [state, expectedProb] of Object.entries(expected)) {
    const actualProb = actual[state] ?? 0;
    const diff = Math.abs(actualProb - expectedProb);
    if (diff > tolerance) {
      mismatches.push(`|${state}\u27E9: expected ${expectedProb.toFixed(3)}, got ${actualProb.toFixed(3)}`);
    }
    totalError += diff;
  }

  for (const [state, actualProb] of Object.entries(actual)) {
    if (!(state in expected) && actualProb > tolerance) {
      mismatches.push(`|${state}\u27E9: unexpected probability ${actualProb.toFixed(3)}`);
      totalError += actualProb;
    }
  }

  if (mismatches.length === 0) {
    return { passed: true, score: 1.0, message: 'All probabilities match within tolerance' };
  }

  const score = Math.max(0, 1 - totalError);
  return {
    passed: false,
    score,
    message: `Probability mismatch:\n${mismatches.join('\n')}`,
  };
}

function normalizeEdges(
  raw: unknown,
): Array<{ source: number; target: number; weight?: number }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: unknown) => {
    if (Array.isArray(e)) {
      return { source: e[0] as number, target: e[1] as number, weight: e[2] as number | undefined };
    }
    return e as { source: number; target: number; weight?: number };
  });
}

function validateApproximationRatio(
  measurements: Record<string, number>,
  params: Record<string, unknown>,
  optimal: number,
  threshold: number,
): { passed: boolean; score: number; message: string } {
  const edges = normalizeEdges(params.edges);

  if (edges.length === 0) {
    return { passed: false, score: 0, message: 'No edges defined in test parameters' };
  }

  if (optimal === 0) {
    return { passed: false, score: 0, message: 'Optimal value is zero; cannot compute ratio' };
  }

  let bestCut = 0;
  let bestBitstring = '';

  for (const bitstring of Object.keys(measurements)) {
    const cutValue = computeCutValue(bitstring, edges);
    if (cutValue > bestCut) {
      bestCut = cutValue;
      bestBitstring = bitstring;
    }
  }

  const ratio = bestCut / optimal;
  const passed = ratio >= threshold;

  if (passed) {
    return {
      passed: true,
      score: ratio,
      message: `Approximation ratio ${ratio.toFixed(3)} (best cut: ${bestCut} from |${bestBitstring}\u27E9, optimal: ${optimal})`,
    };
  }

  return {
    passed: false,
    score: ratio,
    message: `Approximation ratio ${ratio.toFixed(3)} below threshold ${threshold} (best cut: ${bestCut} from |${bestBitstring}\u27E9, optimal: ${optimal})`,
  };
}

export function computeCutValue(
  bitstring: string,
  edges: Array<{ source: number; target: number; weight?: number }>,
): number {
  let cutValue = 0;
  for (const edge of edges) {
    const sourceBit = bitstring[edge.source];
    const targetBit = bitstring[edge.target];
    if (sourceBit !== undefined && targetBit !== undefined && sourceBit !== targetBit) {
      cutValue += edge.weight ?? 1;
    }
  }
  return cutValue;
}
