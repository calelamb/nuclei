import type { SimulationResult } from '../../types/quantum';

interface ExerciseValidationOptions {
  expectedProbabilities?: Record<string, number>;
  expectedMeasurements?: Record<string, number>;
  tolerancePercent: number;
}

function normalizeDistribution(distribution: Record<string, number>): Record<string, number> {
  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return {};

  return Object.fromEntries(
    Object.entries(distribution).map(([state, value]) => [state, value / total]),
  );
}

export function hasExpectedDistribution(distribution?: Record<string, number>): boolean {
  return !!distribution && Object.keys(distribution).length > 0;
}

export function isQuantumCode(code: string): boolean {
  return /(from\s+qiskit\s+import|import\s+qiskit|\bQuantumCircuit\s*\(|import\s+cirq|from\s+cirq\s+import|\bcirq\.|import\s+cudaq|from\s+cudaq\s+import|@cudaq\.kernel|\bcudaq\.)/.test(code);
}

export function validateExerciseResult(
  result: SimulationResult,
  options: ExerciseValidationOptions,
): { success: boolean; message: string } | null {
  const { expectedProbabilities, expectedMeasurements, tolerancePercent } = options;
  const hasProbabilities = hasExpectedDistribution(expectedProbabilities);
  const hasMeasurements = hasExpectedDistribution(expectedMeasurements);

  if (!hasProbabilities && !hasMeasurements) {
    return null;
  }

  const expected = normalizeDistribution(
    hasMeasurements ? (expectedMeasurements ?? {}) : (expectedProbabilities ?? {}),
  );
  const actual = hasMeasurements
    ? normalizeDistribution(result.measurements)
    : normalizeDistribution(result.probabilities);
  const tolerance = tolerancePercent / 100;
  const mismatches: string[] = [];

  for (const [state, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[state] ?? 0;
    if (Math.abs(actualValue - expectedValue) > tolerance) {
      mismatches.push(
        `Expected ~${(expectedValue * 100).toFixed(0)}% on |${state}⟩ but got ${(actualValue * 100).toFixed(0)}%`,
      );
    }
  }

  for (const [state, actualValue] of Object.entries(actual)) {
    if (!(state in expected) && actualValue > tolerance) {
      mismatches.push(
        `Unexpected ${(actualValue * 100).toFixed(0)}% probability on |${state}⟩`,
      );
    }
  }

  if (mismatches.length === 0) {
    return {
      success: true,
      message: 'Solution matches the expected distribution.',
    };
  }

  return {
    success: false,
    message: `${mismatches.join('. ')}.`,
  };
}
