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

/**
 * Whether a plain Run should grade the exercise. An untouched starter is just
 * "see what this does": grading it would turn the card red before the learner
 * has tried anything. Check solution always grades.
 */
export function shouldAutoGrade(code: string, starterCode: string): boolean {
  return code.trim() !== starterCode.trim();
}

export interface ExerciseExpectations {
  expectedProbabilities?: Record<string, number>;
  expectedMeasurements?: Record<string, number>;
  /** Regex sources that must each match the printed output (case-insensitive). */
  expectedOutput?: string[];
  /** Regex sources that must each match the learner's code, comments excluded. */
  requiredCode?: string[];
}

export interface ExerciseRun {
  result: SimulationResult | null;
  output: string[];
  code: string;
  starterCode: string;
  tolerancePercent: number;
}

export function hasAnyExpectation(e: ExerciseExpectations): boolean {
  return hasExpectedDistribution(e.expectedProbabilities)
    || hasExpectedDistribution(e.expectedMeasurements)
    || (e.expectedOutput?.length ?? 0) > 0
    || (e.requiredCode?.length ?? 0) > 0;
}

/** Drops `#` comments line by line so a TODO comment can never satisfy a check. */
export function stripPythonComments(code: string): string {
  return code.split('\n').map((line) => line.replace(/#.*$/, '')).join('\n');
}

function matches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return false;
  }
}

/**
 * Grades one finished run against every expectation the exercise declares. An
 * untouched starter never passes, whatever it prints.
 */
export function validateExerciseRun(
  run: ExerciseRun,
  expectations: ExerciseExpectations,
): { success: boolean; message: string } {
  if (!shouldAutoGrade(run.code, run.starterCode)) {
    return { success: false, message: 'Replace the starter comments with your own code, then run again.' };
  }

  const wantsDistribution = hasExpectedDistribution(expectations.expectedProbabilities)
    || hasExpectedDistribution(expectations.expectedMeasurements);
  if (wantsDistribution && !run.result) {
    return { success: false, message: 'Run your circuit first so there is a result to check.' };
  }

  if (run.result) {
    const distribution = validateExerciseResult(run.result, {
      expectedProbabilities: expectations.expectedProbabilities,
      expectedMeasurements: expectations.expectedMeasurements,
      tolerancePercent: run.tolerancePercent,
    });
    if (distribution && !distribution.success) return distribution;
  }

  const code = stripPythonComments(run.code);
  const missingCode = (expectations.requiredCode ?? []).filter((p) => !matches(p, code));
  if (missingCode.length > 0) {
    return { success: false, message: 'Your code is missing a step the task asks for. Re-read the task or open a hint.' };
  }

  const printed = run.output.join('\n');
  const missingOutput = (expectations.expectedOutput ?? []).filter((p) => !matches(p, printed));
  if (missingOutput.length > 0) {
    return { success: false, message: 'The output does not match the task yet. Check what the task asks you to print, then run again.' };
  }

  return { success: true, message: 'Your solution checks out.' };
}
