import type { TestCaseResult } from '../../types/challenge';

export interface SharedCodeFailure {
  /** "Your code didn't run: SyntaxError on line 5" */
  title: string;
  /** The error text itself, once. */
  detail: string;
}

const ERROR_TYPE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))\b/;

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
  const type = ERROR_TYPE_RE.exec(first.message)?.[1];
  const where = first.errorLine ? ` on line ${first.errorLine}` : '';
  const what = type ? `${type}${where}` : first.errorLine ? `error on line ${first.errorLine}` : 'error';
  return { title: `Your code didn't run: ${what}`, detail: first.message };
}
