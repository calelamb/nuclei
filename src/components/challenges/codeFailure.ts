import type { TestCaseResult } from '../../types/challenge';

export interface SharedCodeFailure {
  /** "Your code didn't run (line 5)" */
  title: string;
  /** The error text itself, once. */
  detail: string;
  /** 1-based line in the student's code, for an editor marker. */
  line: number | null;
}

function isCodeFailure(result: TestCaseResult): boolean {
  return (result.verdict === 'compile_error' || result.verdict === 'runtime_error')
    && !result.passed && !result.unsupported && !result.engineUnavailable;
}

/**
 * When every case that ran failed with the very same compile or runtime error, the student's
 * program never produced anything to grade: say that once instead of one red row per case.
 */
export function sharedCodeFailure(results: ReadonlyArray<TestCaseResult>): SharedCodeFailure | null {
  if (results.length === 0 || !results.every(isCodeFailure)) return null;
  const first = results[0];
  if (!results.every((result) => result.message === first.message)) return null;
  const where = first.errorLine ? ` (line ${first.errorLine})` : '';
  // The typed message below the title already names the error kind, so the title does not repeat it.
  return { title: `Your code didn't run${where}`, detail: first.message, line: first.errorLine ?? null };
}
