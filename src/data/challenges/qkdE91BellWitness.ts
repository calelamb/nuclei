import type { QuantumChallenge } from '../../types/challenge';

const starter = `# Compute the CHSH witness for E91.
# correlations has keys: a0b0, a0b1, a1b0, a1b1
# Use S = E(a0,b0) + E(a0,b1) + E(a1,b0) - E(a1,b1)
# Return {"chsh": S, "certified": True/False}

chsh = 0.0
certified = False
return {"chsh": chsh, "certified": certified}`;

export const e91BellWitness: QuantumChallenge = {
  id: 'qkd-e91-bell-witness',
  title: 'E91 Bell Witness',
  difficulty: 'medium',
  category: 'protocols',
  practiceTrack: 'qkd',
  contract_kind: 'returns_value',
  description: 'E91 uses Bell inequality violation as a security witness. Compute the CHSH score and decide whether the correlations certify quantum security.',
  constraints: [
    'correlations is an object with a0b0, a0b1, a1b0, and a1b1.',
    'Use S = a0b0 + a0b1 + a1b0 - a1b1.',
    'certified is true when abs(S) is greater than 2.',
  ],
  examples: [
    {
      input: 'correlations={"a0b0":0.7071,"a0b1":0.7071,"a1b0":0.7071,"a1b1":-0.7071}',
      output: '{"chsh": 2.8284, "certified": true}',
      explanation: 'The score exceeds the classical CHSH bound of 2, so the correlations are Bell-certified.',
    },
  ],
  testCases: [
    {
      id: 'e91-visible-ideal',
      label: 'Near-ideal quantum correlations',
      description: 'Recognizes a Bell violation near 2 sqrt(2).',
      params: {
        correlations: { a0b0: 0.7071, a0b1: 0.7071, a1b0: 0.7071, a1b1: -0.7071 },
      },
      validation: { type: 'value_match', expected: { chsh: 2.8284, certified: true }, tolerance: 0.01 },
      hidden: false,
      weight: 1,
    },
    {
      id: 'e91-visible-classical',
      label: 'Classical bound',
      description: 'Rejects correlations at the classical CHSH bound.',
      params: {
        correlations: { a0b0: 0.5, a0b1: 0.5, a1b0: 0.5, a1b1: -0.5 },
      },
      validation: { type: 'value_match', expected: { chsh: 2, certified: false }, tolerance: 0.01 },
      hidden: false,
      weight: 1,
    },
    {
      id: 'e91-hidden-negative',
      label: 'Negative violation',
      description: 'Uses absolute CHSH score for certification.',
      params: {
        correlations: { a0b0: -0.72, a0b1: -0.71, a1b0: -0.7, a1b1: 0.69 },
      },
      validation: { type: 'value_match', expected: { chsh: -2.82, certified: true }, tolerance: 0.02 },
      hidden: true,
      weight: 1,
    },
    {
      id: 'e91-hidden-noisy',
      label: 'Noisy weak correlations',
      description: 'Rejects weak/noisy correlations that do not violate CHSH.',
      params: {
        correlations: { a0b0: 0.41, a0b1: 0.38, a1b0: 0.36, a1b1: -0.39 },
      },
      validation: { type: 'value_match', expected: { chsh: 1.54, certified: false }, tolerance: 0.01 },
      hidden: true,
      weight: 1,
    },
  ],
  starterCode: { qiskit: starter, cirq: starter, 'cuda-q': starter },
  hints: [
    'The CHSH witness combines four correlation estimates with one minus sign.',
    'The classical bound is 2. A score above 2 means Bell violation.',
    'Use abs(chsh) for certification because a negative violation can be equally strong.',
  ],
  tags: ['QKD', 'E91', 'CHSH', 'Bell inequality', 'cryptography', 'protocols'],
  estimatedMinutes: 14,
  totalSubmissions: 0,
  acceptanceRate: 0.58,
};
