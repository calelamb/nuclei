import type { QuantumChallenge } from '../../types/challenge';

const starter = `# Analyze kept BB84 rounds under an intercept-resend attack.
# Return {"kept_rounds": [...], "disturbed_rounds": [...], "error_rate": number}
kept_rounds = []
disturbed_rounds = []

# TODO: a kept round has alice_bases[i] == bob_bases[i]
# TODO: a disturbed kept round has alice_bits[i] != bob_bits[i]

error_rate = 0.0
return {"kept_rounds": kept_rounds, "disturbed_rounds": disturbed_rounds, "error_rate": error_rate}`;

export const qkdInterceptResendAudit: QuantumChallenge = {
  id: 'qkd-intercept-resend-audit',
  title: 'Intercept-Resend Audit',
  difficulty: 'medium',
  category: 'protocols',
  practiceTrack: 'qkd',
  contract_kind: 'returns_value',
  description: 'Audit a BB84 transcript after Eve performs intercept-resend. Identify which rounds survive sifting and which kept rounds show detectable disturbance.',
  constraints: [
    'All input arrays have the same length.',
    'kept_rounds and disturbed_rounds are zero-based indices.',
    'error_rate is disturbed kept rounds divided by kept rounds, or 0 when no rounds are kept.',
  ],
  examples: [
    {
      input: 'alice_bases=["Z","X"], bob_bases=["Z","X"], alice_bits=[1,0], bob_bits=[1,1]',
      output: '{"kept_rounds": [0, 1], "disturbed_rounds": [1], "error_rate": 0.5}',
      explanation: 'Both rounds survive sifting, but round 1 has a bit mismatch.',
    },
  ],
  testCases: [
    {
      id: 'intercept-visible-mixed',
      label: 'Mixed transcript',
      description: 'Finds kept and disturbed rounds in a realistic transcript.',
      params: {
        alice_bases: ['Z', 'X', 'Z', 'X', 'Z', 'X', 'Z', 'X'],
        bob_bases: ['Z', 'X', 'X', 'X', 'Z', 'Z', 'Z', 'X'],
        eve_bases: ['Z', 'Z', 'X', 'Z', 'Z', 'X', 'X', 'Z'],
        alice_bits: [0, 1, 1, 0, 1, 0, 0, 1],
        bob_bits: [0, 0, 0, 1, 1, 1, 0, 0],
      },
      validation: {
        type: 'value_match',
        expected: { kept_rounds: [0, 1, 3, 4, 6, 7], disturbed_rounds: [1, 3, 7], error_rate: 0.5 },
        tolerance: 0.001,
      },
      hidden: false,
      weight: 1,
    },
    {
      id: 'intercept-visible-clean',
      label: 'Clean kept rounds',
      description: 'Handles a transcript with no detected kept-round disturbance.',
      params: {
        alice_bases: ['Z', 'Z', 'X', 'X'],
        bob_bases: ['Z', 'X', 'X', 'Z'],
        eve_bases: ['Z', 'X', 'X', 'Z'],
        alice_bits: [1, 0, 1, 0],
        bob_bits: [1, 1, 1, 1],
      },
      validation: {
        type: 'value_match',
        expected: { kept_rounds: [0, 2], disturbed_rounds: [], error_rate: 0 },
        tolerance: 0.001,
      },
      hidden: false,
      weight: 1,
    },
    {
      id: 'intercept-hidden-none-kept',
      label: 'No kept rounds',
      description: 'Avoids division by zero when no bases match.',
      params: {
        alice_bases: ['Z', 'X', 'Z'],
        bob_bases: ['X', 'Z', 'X'],
        eve_bases: ['Z', 'Z', 'X'],
        alice_bits: [1, 0, 1],
        bob_bits: [0, 1, 0],
      },
      validation: {
        type: 'value_match',
        expected: { kept_rounds: [], disturbed_rounds: [], error_rate: 0 },
        tolerance: 0.001,
      },
      hidden: true,
      weight: 1,
    },
    {
      id: 'intercept-hidden-all-disturbed',
      label: 'All kept rounds disturbed',
      description: 'Computes a full 100% kept-round error rate.',
      params: {
        alice_bases: ['Z', 'X', 'Z', 'X'],
        bob_bases: ['Z', 'X', 'Z', 'X'],
        eve_bases: ['X', 'Z', 'X', 'Z'],
        alice_bits: [0, 1, 0, 1],
        bob_bits: [1, 0, 1, 0],
      },
      validation: {
        type: 'value_match',
        expected: { kept_rounds: [0, 1, 2, 3], disturbed_rounds: [0, 1, 2, 3], error_rate: 1 },
        tolerance: 0.001,
      },
      hidden: true,
      weight: 1,
    },
  ],
  starterCode: { qiskit: starter, cirq: starter, 'cuda-q': starter },
  hints: [
    'Eve bases explain why disturbance happens, but the transcript evidence is in the kept-round bit mismatches.',
    'Only compare Alice and Bob bits after basis sifting.',
    'Return indices, not bit values, for kept_rounds and disturbed_rounds.',
  ],
  tags: ['QKD', 'BB84', 'intercept-resend', 'QBER', 'cryptography', 'protocols'],
  estimatedMinutes: 16,
  totalSubmissions: 0,
  acceptanceRate: 0.52,
};
