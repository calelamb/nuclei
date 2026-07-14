import { describe, expect, it } from 'vitest';
import { QUANTUM_CHALLENGES } from '.';

describe('challenge catalog normalization', () => {
  it('normalizes existing circuit challenges to the general practice track', () => {
    const bell = QUANTUM_CHALLENGES.find((challenge) => challenge.id === 'bell-state-factory');

    expect(bell).toEqual(expect.objectContaining({
      contract_kind: 'returns_circuit',
      practiceTrack: 'general',
      default_framework: 'qiskit',
    }));
    expect(bell?.starter_template).toContain('return qc');
  });

  it('registers GHZ and W as fidelity-graded state-preparation challenges', () => {
    const ghz = QUANTUM_CHALLENGES.find((c) => c.id === 'ghz-state');
    const w = QUANTUM_CHALLENGES.find((c) => c.id === 'w-state');

    for (const challenge of [ghz, w]) {
      expect(challenge?.category).toBe('state-preparation');
      expect(challenge?.contract_kind).toBe('returns_circuit');
      expect(challenge?.referenceCode).toContain('def reference');
      // every test case is graded by state fidelity, not marginals
      expect(challenge?.testCases.every((tc) => tc.validation.type === 'state_fidelity')).toBe(true);
      expect(challenge?.visible_tests?.length).toBeGreaterThan(0);
      expect(challenge?.hidden_tests?.length).toBeGreaterThan(0);
    }

    // GHZ carries a provable entangling-gate par (n-1); W stays informational.
    expect(ghz?.efficiency?.twoQubitGates).toBe(4);
    expect(w?.efficiency).toBeUndefined();
  });

  it('registers QKD challenges as visible and hidden value-return protocol practice', () => {
    const qkdChallenges = QUANTUM_CHALLENGES.filter((challenge) => challenge.practiceTrack === 'qkd');

    expect(qkdChallenges.map((challenge) => challenge.id).sort()).toEqual([
      'qkd-bb84-key-sifter',
      'qkd-detect-eve-qber',
      'qkd-e91-bell-witness',
      'qkd-intercept-resend-audit',
    ]);

    for (const challenge of qkdChallenges) {
      expect(challenge.category).toBe('protocols');
      expect(challenge.contract_kind).toBe('returns_value');
      expect(challenge.visible_tests?.length).toBeGreaterThan(0);
      expect(challenge.hidden_tests?.length).toBeGreaterThan(0);
      expect(challenge.tags).toContain('QKD');
      expect(challenge.starter_template).toContain('JSON-serializable value');
      expect(challenge.starter_template).not.toContain('return qc');
    }
  });
});
