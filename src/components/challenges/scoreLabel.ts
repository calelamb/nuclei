import type { TestCase } from '../../types/challenge';

/** One truthful number per case: "fidelity N%" when the state is graded, "match N%" when counts or values are. */
export function scoreLabel(testCase: TestCase, score: number): string {
  const percent = (score * 100).toFixed(0);
  return testCase.validation.type === 'state_fidelity' ? `fidelity ${percent}%` : `match ${percent}%`;
}
