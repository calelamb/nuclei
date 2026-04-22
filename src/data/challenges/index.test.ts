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
