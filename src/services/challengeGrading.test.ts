import { describe, expect, it } from 'vitest';
import { isOracleChallenge, isStateVerified } from './challengeGrading';
import { QUANTUM_CHALLENGES } from '../data/challenges';
import type { QuantumChallenge } from '../types/challenge';

function find(id: string): QuantumChallenge {
  const c = QUANTUM_CHALLENGES.find((x) => x.id === id);
  if (!c) throw new Error(`missing challenge ${id}`);
  return c;
}

describe('isStateVerified', () => {
  it('is true for fidelity-graded state-prep and oracle challenges', () => {
    for (const id of ['bell-state-factory', 'uniform-superposition', 'ghz-state', 'w-state',
      'bernstein-vazirani', 'grovers-search', 'simons-algorithm']) {
      expect(isStateVerified(find(id))).toBe(true);
    }
  });

  it('is false for marginal / approximation-ratio graded challenges', () => {
    // MaxCut grades on approximation ratio; a classical optimal cut is a valid
    // (non-quantum) answer, so it is deliberately not state-verified.
    expect(isStateVerified(find('maxcut-small-graphs'))).toBe(false);
  });

  it('is false with no test cases', () => {
    expect(isStateVerified({ testCases: [] } as unknown as QuantumChallenge)).toBe(false);
  });
});

describe('isOracleChallenge', () => {
  it('flags the query-model algorithm challenges', () => {
    expect(isOracleChallenge(find('bernstein-vazirani'))).toBe(true);
    expect(isOracleChallenge(find('grovers-search'))).toBe(true);
    expect(isOracleChallenge(find('simons-algorithm'))).toBe(true);
    expect(isOracleChallenge(find('bell-state-factory'))).toBe(false);
  });
});
