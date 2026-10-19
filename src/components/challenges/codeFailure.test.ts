import { describe, expect, it } from 'vitest';
import { sharedCodeFailure } from './codeFailure';
import type { TestCaseResult } from '../../types/challenge';

function result(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    testCaseId: 't', passed: false, score: 0, verdict: 'compile_error',
    message: "SyntaxError: unmatched ')'", executionTimeMs: 0, ...overrides,
  };
}

describe('sharedCodeFailure (learn-r10-03)', () => {
  it('names the line once and leaves the error type to the detail for four identical failures', () => {
    const failure = sharedCodeFailure([1, 2, 3, 4].map((n) => result({ testCaseId: `t${n}`, errorLine: 5 })));
    expect(failure).toEqual({ title: "Your code didn't run (line 5)", detail: "SyntaxError: unmatched ')'", line: 5 });
  });

  it('omits the line when none is known', () => {
    expect(sharedCodeFailure([result({ verdict: 'runtime_error', message: "NameError: name 'x' is not defined" })])?.title)
      .toBe("Your code didn't run");
  });

  it('is null when any case ran, when messages differ, or for non-code failures', () => {
    expect(sharedCodeFailure([])).toBeNull();
    expect(sharedCodeFailure([result(), result({ verdict: 'accepted', passed: true, score: 1 })])).toBeNull();
    expect(sharedCodeFailure([result(), result({ message: 'other' })])).toBeNull();
    expect(sharedCodeFailure([result({ verdict: 'wrong_answer' })])).toBeNull();
    expect(sharedCodeFailure([result({ engineUnavailable: true, verdict: 'runtime_error' })])).toBeNull();
    expect(sharedCodeFailure([result({ unsupported: true, verdict: 'runtime_error' })])).toBeNull();
  });
});
