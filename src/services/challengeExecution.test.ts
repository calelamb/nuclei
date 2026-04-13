import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runTestCases } from './challengeExecution';
import type { TestCase } from '../types/challenge';

vi.mock('./kernelSession', () => ({
  createKernelSession: vi.fn(),
}));

describe('challengeExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
