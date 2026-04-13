import { describe, expect, it } from 'vitest';
import { filterChallenges } from './challengeModeStore';
import type { ProblemProgress, QuantumChallenge } from '../types/challenge';

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
});
