import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestCode, runTestCases } from './challengeExecution';
import type { QuantumChallenge, TestCase } from '../types/challenge';

vi.mock('./kernelSession', () => ({
  createKernelSession: vi.fn(),
}));

describe('challengeExecution', () => {
  const baseChallenge: QuantumChallenge = {
    id: 'test',
    title: 'Test Challenge',
    difficulty: 'easy',
    category: 'algorithms',
    description: 'desc',
    constraints: [],
    examples: [],
    testCases: [],
    starterCode: { qiskit: '', cirq: '', 'cuda-q': '' },
    hints: [],
    tags: [],
    estimatedMinutes: 5,
    totalSubmissions: 1,
    acceptanceRate: 1,
    default_framework: 'qiskit',
    entrypoint_name: 'solve',
    contract_kind: 'returns_circuit',
    arguments: [{ name: 'bell_index', type: 'integer', description: 'desc', sample: 0 }],
    visible_tests: [],
    hidden_tests: [],
    starter_template: 'def solve(bell_index):\n    pass\n',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds canonical qiskit harness code for function-first challenges', () => {
    const code = buildTestCode(
      'from qiskit import QuantumCircuit\n\ndef solve(bell_index):\n    qc = QuantumCircuit(2, 2)\n    return qc\n',
      baseChallenge,
      { bell_index: 2 },
      'qiskit',
    );

    expect(code).toContain('__nuclei_circuit = solve(**__nuclei_params)');
    expect(code).toContain("must return a QuantumCircuit");
  });

  it('creates visible failure results when the kernel is unavailable', async () => {
    const { createKernelSession } = await import('./kernelSession');
    vi.mocked(createKernelSession).mockRejectedValue(new Error('offline'));

    const testCases: TestCase[] = [
      {
        id: 'tc-1',
        label: 'Case 1',
        description: 'desc',
        params: {},
        validation: { type: 'probability_match', expected: { '0': 1 }, tolerance: 0.01 },
        hidden: false,
        weight: 1,
      },
      {
        id: 'tc-2',
        label: 'Case 2',
        description: 'desc',
        params: {},
        validation: { type: 'probability_match', expected: { '1': 1 }, tolerance: 0.01 },
        hidden: true,
        weight: 1,
      },
    ];
    const onResult = vi.fn();
    const onError = vi.fn();

    const results = await runTestCases(
      'from qiskit import QuantumCircuit',
      { ...baseChallenge, testCases },
      testCases,
      'qiskit',
      'desktop',
      1024,
      vi.fn(),
      onResult,
      onError,
    );

    expect(onError).toHaveBeenCalledWith('offline');
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(results.every((result) => result.passed === false)).toBe(true);
    expect(results[0].message).toContain('Connection error');
    expect(results[0].verdict).toBe('runtime_error');
  });
});
