import { describe, expect, it } from 'vitest';
import type { SubmissionFacts } from './policy';
import { estimateSubmissionCost } from './costEstimate';

const BASE: SubmissionFacts = {
  provider: 'simulator',
  backend: 'local-sim',
  shots: 1024,
  qubits: 4,
  depth: 8,
  isSimulator: true,
  estimatedCost: null,
};

describe('estimateSubmissionCost', () => {
  it('returns 0 for simulator submissions', () => {
    expect(estimateSubmissionCost(BASE)).toBe(0);
  });

  it('returns null for real QPU submissions (cost not yet modeled)', () => {
    const facts: SubmissionFacts = { ...BASE, provider: 'ibm', backend: 'ibm-brisbane', isSimulator: false };
    expect(estimateSubmissionCost(facts)).toBeNull();
  });
});
