import type { QuantumChallenge } from '../../types/challenge';

const starter = `# Estimate the quantum bit error rate (QBER) from publicly compared sample bits.
# Return {"qber": error_rate, "abort": True/False}
errors = 0

# TODO: count positions where alice_sample and bob_sample differ

qber = 0.0
abort = False
return {"qber": qber, "abort": abort}`;

export const qkdDetectEve: QuantumChallenge = {
  id: 'qkd-detect-eve-qber',
  title: 'Detect Eve With QBER',
  difficulty: 'easy',
  category: 'protocols',
  practiceTrack: 'qkd',
  contract_kind: 'returns_value',
  description: 'Alice and Bob sacrifice a sample of their sifted key to estimate the quantum bit error rate. If the error rate is too high, they abort the key.',
  constraints: [
    'alice_sample and bob_sample have the same nonzero length.',
    'Return exactly {"qber": number, "abort": boolean}.',
    'abort is true when qber is greater than abort_threshold.',
  ],
  examples: [
    {
      input: 'alice_sample=[1,0,1,1], bob_sample=[1,1,1,0], abort_threshold=0.11',
      output: '{"qber": 0.5, "abort": true}',
      explanation: 'Two of four sampled bits differ, so QBER is 0.5 and the key must be rejected.',
    },
  ],
  testCases: [
    {
      id: 'qber-visible-eve',
      label: 'High error sample',
      description: 'Detects a sample with too many disagreements.',
      params: {
        alice_sample: [1, 0, 1, 1],
        bob_sample: [1, 1, 1, 0],
        abort_threshold: 0.11,
      },
      validation: { type: 'value_match', expected: { qber: 0.5, abort: true }, tolerance: 0.001 },
      hidden: false,
      weight: 1,
    },
    {
      id: 'qber-visible-clean',
      label: 'Clean sample',
      description: 'Accepts a clean sample.',
      params: {
        alice_sample: [0, 1, 1, 0, 1],
        bob_sample: [0, 1, 1, 0, 1],
        abort_threshold: 0.11,
      },
      validation: { type: 'value_match', expected: { qber: 0, abort: false }, tolerance: 0.001 },
      hidden: false,
      weight: 1,
    },
    {
      id: 'qber-hidden-borderline',
      label: 'Borderline threshold',
      description: 'Uses greater-than threshold semantics.',
      params: {
        alice_sample: [1, 1, 0, 0],
        bob_sample: [1, 0, 0, 0],
        abort_threshold: 0.25,
      },
      validation: { type: 'value_match', expected: { qber: 0.25, abort: false }, tolerance: 0.001 },
      hidden: true,
      weight: 1,
    },
    {
      id: 'qber-hidden-noisy',
      label: 'Noisy long sample',
      description: 'Computes QBER on a longer sample.',
      params: {
        alice_sample: [1, 0, 1, 0, 1, 0, 1, 0],
        bob_sample: [1, 0, 0, 0, 1, 1, 0, 0],
        abort_threshold: 0.2,
      },
      validation: { type: 'value_match', expected: { qber: 0.375, abort: true }, tolerance: 0.001 },
      hidden: true,
      weight: 1,
    },
  ],
  starterCode: { qiskit: starter, cirq: starter, 'cuda-q': starter },
  hints: [
    'QBER is disagreements divided by the number of compared sample bits.',
    'The threshold comparison is qber > abort_threshold.',
    'In BB84 intercept-resend attacks, QBER often becomes large enough to detect quickly.',
  ],
  tags: ['QKD', 'BB84', 'QBER', 'cryptography', 'protocols', 'eavesdropper'],
  estimatedMinutes: 10,
  totalSubmissions: 0,
  acceptanceRate: 0.68,
};
