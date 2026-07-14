import { beforeEach, describe, expect, it } from 'vitest';
import { filterChallenges, useChallengeModeStore } from './challengeModeStore';
import type { CircuitMetrics, EfficiencyReport, ProblemProgress, QuantumChallenge, Submission } from '../types/challenge';

const challenges: QuantumChallenge[] = [
  {
    id: 'easy-bell',
    title: 'Bell State Factory',
    difficulty: 'easy',
    category: 'state-preparation',
    description: 'Prepare Bell states',
    constraints: [],
    examples: [],
    testCases: [],
    starterCode: { qiskit: '', cirq: '', 'cuda-q': '' },
    hints: [],
    tags: ['bell-state', 'entanglement'],
    estimatedMinutes: 10,
    totalSubmissions: 10,
    acceptanceRate: 0.8,
  },
  {
    id: 'hard-grover',
    title: "Grover's Search",
    difficulty: 'hard',
    category: 'algorithms',
    description: 'Search the marked state',
    constraints: [],
    examples: [],
    testCases: [],
    starterCode: { qiskit: '', cirq: '', 'cuda-q': '' },
    hints: [],
    tags: ['grover', 'oracle'],
    estimatedMinutes: 20,
    totalSubmissions: 10,
    acceptanceRate: 0.4,
  },
  {
    id: 'qkd-bb84',
    title: 'BB84 Key Sifter',
    difficulty: 'easy',
    category: 'protocols',
    practiceTrack: 'qkd',
    contract_kind: 'returns_value',
    description: 'Sift BB84 key bits',
    constraints: [],
    examples: [],
    testCases: [],
    starterCode: { qiskit: '', cirq: '', 'cuda-q': '' },
    hints: [],
    tags: ['QKD', 'BB84', 'protocols'],
    estimatedMinutes: 10,
    totalSubmissions: 10,
    acceptanceRate: 0.7,
  },
];

const progress: Record<string, ProblemProgress> = {
  'easy-bell': {
    challengeId: 'easy-bell',
    status: 'solved',
    bestScore: 100,
    attempts: 1,
    submissions: [],
    currentCode: { qiskit: '', cirq: '', 'cuda-q': '' },
  },
  'hard-grover': {
    challengeId: 'hard-grover',
    status: 'attempted',
    bestScore: 50,
    attempts: 2,
    submissions: [],
    currentCode: { qiskit: '', cirq: '', 'cuda-q': '' },
  },
};

describe('challengeModeStore filtering', () => {
  it('filters by search, difficulty, and status', () => {
    expect(filterChallenges(challenges, null, null, 'bell', 'all', progress)).toHaveLength(1);
    expect(filterChallenges(challenges, 'hard', null, '', 'all', progress)).toHaveLength(1);
    expect(filterChallenges(challenges, null, null, '', 'solved', progress)).toHaveLength(1);
    expect(filterChallenges(challenges, null, null, '', 'attempted', progress)).toHaveLength(1);
  });

  it('defaults to all practice and composes QKD tab filtering with search/status filters', () => {
    expect(filterChallenges(challenges, null, null, '', 'all', progress)).toHaveLength(3);
    expect(filterChallenges(challenges, null, null, '', 'all', progress, 'qkd')).toEqual([
      expect.objectContaining({ id: 'qkd-bb84' }),
    ]);
    expect(filterChallenges(challenges, null, null, 'qkd', 'all', progress, 'qkd')).toHaveLength(1);
    expect(filterChallenges(challenges, null, null, '', 'solved', progress, 'qkd')).toHaveLength(0);
  });
});

describe('challengeModeStore addSubmission efficiency folding', () => {
  function metrics(twoQ: number, depth: number): CircuitMetrics {
    return { twoQubitGates: twoQ, depth, gateCount: twoQ + depth, qubits: 2 };
  }
  function submission(over: Partial<Submission>): Submission {
    return {
      id: `sub-${over.id ?? '1'}`,
      challengeId: 'c1',
      code: 'x',
      framework: 'qiskit',
      timestamp: '2026-07-14T00:00:00.000Z',
      status: 'accepted',
      testCaseResults: [],
      totalScore: 100,
      executionTimeMs: 1,
      ...over,
    };
  }
  const optimalReport = { isOptimal: true, hasTarget: true } as EfficiencyReport;
  const nonOptimalReport = { isOptimal: false, hasTarget: true } as EfficiencyReport;

  beforeEach(() => {
    useChallengeModeStore.setState({ progress: {} });
  });

  it('records best metrics and latches solvedOptimally on an optimal accepted submission', () => {
    useChallengeModeStore.getState().addSubmission('c1', submission({
      metrics: metrics(1, 2),
      efficiency: optimalReport,
    }));
    const p = useChallengeModeStore.getState().progress.c1;
    expect(p.solvedOptimally).toBe(true);
    expect(p.bestMetrics).toEqual(metrics(1, 2));
  });

  it('keeps the element-wise best metrics and never un-latches the star', () => {
    const store = useChallengeModeStore.getState();
    store.addSubmission('c1', submission({ id: '1', metrics: metrics(1, 4), efficiency: optimalReport }));
    store.addSubmission('c1', submission({ id: '2', metrics: metrics(3, 2), efficiency: nonOptimalReport }));
    const p = useChallengeModeStore.getState().progress.c1;
    // best is the min of each metric across submissions
    expect(p.bestMetrics?.twoQubitGates).toBe(1);
    expect(p.bestMetrics?.depth).toBe(2);
    // a later non-optimal submission doesn't remove an earned star
    expect(p.solvedOptimally).toBe(true);
  });

  it('does not mark solvedOptimally when the accepted submission missed a target', () => {
    useChallengeModeStore.getState().addSubmission('c1', submission({
      metrics: metrics(3, 2),
      efficiency: nonOptimalReport,
    }));
    expect(useChallengeModeStore.getState().progress.c1.solvedOptimally).toBe(false);
  });
});
