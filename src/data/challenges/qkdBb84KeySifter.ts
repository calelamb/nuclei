import type { QuantumChallenge } from '../../types/challenge';

const starter = `# Keep only Alice's bits from rounds where Alice and Bob used the same basis.
# Bases are strings: "Z" for computational basis, "X" for Hadamard basis.
kept_key = []

# TODO: scan the rounds and append alice_bits[i] when alice_bases[i] == bob_bases[i]

return kept_key`;

export const bb84KeySifter: QuantumChallenge = {
  id: 'qkd-bb84-key-sifter',
  title: 'BB84 Key Sifter',
  difficulty: 'easy',
  category: 'protocols',
  practiceTrack: 'qkd',
  contract_kind: 'returns_value',
  description: `In BB84, Alice and Bob publicly compare bases, not bit values. Your job is to build the sifted key by keeping Alice's bit only for rounds where the bases match.`,
  constraints: [
    'alice_bits, alice_bases, and bob_bases have the same length.',
    'Bases are "Z" or "X".',
    'Return a list of integers in the original round order.',
  ],
  examples: [
    {
      input: 'alice_bits=[1,0,1,1], alice_bases=["Z","X","Z","X"], bob_bases=["Z","Z","Z","X"]',
      output: '[1, 1, 1]',
      explanation: 'Rounds 0, 2, and 3 have matching bases, so Alice keeps bits 1, 1, and 1.',
    },
  ],
  testCases: [
    {
      id: 'bb84-sift-visible',
      label: 'Mixed matching bases',
      description: 'Keeps only rounds with matching bases.',
      params: {
        alice_bits: [1, 0, 1, 1],
        alice_bases: ['Z', 'X', 'Z', 'X'],
        bob_bases: ['Z', 'Z', 'Z', 'X'],
      },
      validation: { type: 'value_match', expected: [1, 1, 1] },
      hidden: false,
      weight: 1,
    },
    {
      id: 'bb84-sift-visible-alt',
      label: 'Alternating bases',
      description: 'Handles alternating Z/X basis choices.',
      params: {
        alice_bits: [0, 1, 0, 1, 1, 0],
        alice_bases: ['Z', 'X', 'X', 'Z', 'X', 'Z'],
        bob_bases: ['X', 'X', 'Z', 'Z', 'X', 'X'],
      },
      validation: { type: 'value_match', expected: [1, 1, 1] },
      hidden: false,
      weight: 1,
    },
    {
      id: 'bb84-sift-hidden-none',
      label: 'No matching bases',
      description: 'Returns an empty key when no rounds survive sifting.',
      params: {
        alice_bits: [1, 1, 0, 0],
        alice_bases: ['Z', 'X', 'Z', 'X'],
        bob_bases: ['X', 'Z', 'X', 'Z'],
      },
      validation: { type: 'value_match', expected: [] },
      hidden: true,
      weight: 1,
    },
    {
      id: 'bb84-sift-hidden-all',
      label: 'All matching bases',
      description: 'Keeps every bit when every basis matches.',
      params: {
        alice_bits: [0, 1, 1, 0, 1],
        alice_bases: ['Z', 'Z', 'X', 'X', 'Z'],
        bob_bases: ['Z', 'Z', 'X', 'X', 'Z'],
      },
      validation: { type: 'value_match', expected: [0, 1, 1, 0, 1] },
      hidden: true,
      weight: 1,
    },
  ],
  starterCode: { qiskit: starter, cirq: starter, 'cuda-q': starter },
  hints: [
    'Public basis comparison tells you which rounds survive; it does not reveal the kept bit values.',
    'Use the same index to compare alice_bases and bob_bases.',
    'Append Alice\'s bit, not Bob\'s result, because the ideal sifted key is Alice\'s original key.',
  ],
  tags: ['QKD', 'BB84', 'cryptography', 'protocols', 'basis-sifting'],
  estimatedMinutes: 8,
  totalSubmissions: 0,
  acceptanceRate: 0.76,
};
