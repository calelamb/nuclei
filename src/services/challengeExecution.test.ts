import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestCode, buildValueTestCode, runTestCases } from './challengeExecution';
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

  it('appends the reference + fidelity recording when referenceCode is set', () => {
    const code = buildTestCode(
      'def solve(bell_index):\n    from qiskit import QuantumCircuit\n    return QuantumCircuit(2, 2)\n',
      { ...baseChallenge, referenceCode: 'from qiskit import QuantumCircuit\n\ndef reference(bell_index):\n    return QuantumCircuit(2, 2)\n' },
      { bell_index: 0 },
      'qiskit',
    );

    expect(code).toContain('def reference(bell_index)');
    expect(code).toContain('state_fidelity');
    expect(code).toContain('record_metric("fidelity"');
    expect(code).toContain('remove_final_measurements');
  });

  it('injects an opaque oracle and never passes the secret to solve', () => {
    const code = buildTestCode(
      'def solve(oracle):\n    from qiskit import QuantumCircuit\n    return QuantumCircuit(oracle.num_qubits, oracle.num_qubits - 1)\n',
      {
        ...baseChallenge,
        oracle: {
          solveParams: [],
          queryLabel: 'oracle',
          builderCode: 'from qiskit import QuantumCircuit\n\ndef build_oracle(hidden_string, **_):\n    return QuantumCircuit(len(hidden_string) + 1, name="oracle").to_gate(label="oracle")\n',
        },
        referenceCode: 'def reference(hidden_string, **_):\n    from qiskit import QuantumCircuit\n    return QuantumCircuit(len(hidden_string) + 1, len(hidden_string))\n',
      },
      { hidden_string: '101' },
      'qiskit',
    );

    expect(code).toContain('def build_oracle');
    expect(code).toContain('__nuclei_oracle = build_oracle(**__nuclei_params)');
    expect(code).toContain('solve(__nuclei_oracle)');
    expect(code).toContain('record_metric("oracle_queries"');
    expect(code).toContain('record_metric("fidelity"');
    // the secret must never be handed to solve as an argument
    expect(code).not.toContain("solve(__nuclei_oracle, hidden_string");
  });

  it('omits the fidelity block when no referenceCode is present', () => {
    const code = buildTestCode(
      'def solve(bell_index):\n    pass\n',
      baseChallenge,
      { bell_index: 0 },
      'qiskit',
    );
    expect(code).not.toContain('record_metric("fidelity"');
  });

  it('builds a marked JSON harness for value-return challenges', () => {
    const code = buildValueTestCode(
      'def solve(alice_bits):\n    return alice_bits\n',
      { ...baseChallenge, contract_kind: 'returns_value' },
      { alice_bits: [1, 0, 1] },
    );

    expect(code).toContain('__nuclei_value = solve(**__nuclei_params)');
    expect(code).toContain('__NUCLEI_CHALLENGE_VALUE__=');
    expect(code).toContain('must return a JSON-serializable value');
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

  it('runs value-return challenges through run_python in web mode', async () => {
    const { createKernelSession } = await import('./kernelSession');
    vi.mocked(createKernelSession).mockImplementation(async (_platform, onMessage) => ({
      send: vi.fn((message) => {
        expect(message.type).toBe('run_python');
        onMessage({ type: 'output', text: '__NUCLEI_CHALLENGE_VALUE__={"kept":[1,0]}\n' });
        onMessage({ type: 'python_result', success: true });
      }),
      close: vi.fn(),
    }));

    const testCases: TestCase[] = [
      {
        id: 'tc-value',
        label: 'Value Case',
        description: 'desc',
        params: { alice_bits: [1, 0] },
        validation: { type: 'value_match', expected: { kept: [1, 0] } },
        hidden: false,
        weight: 1,
      },
    ];
    const onResult = vi.fn();
    const onError = vi.fn();

    const results = await runTestCases(
      'def solve(alice_bits):\n    return {"kept": alice_bits}\n',
      {
        ...baseChallenge,
        contract_kind: 'returns_value',
        practiceTrack: 'qkd',
        testCases,
      },
      testCases,
      'qiskit',
      'web',
      1024,
      vi.fn(),
      onResult,
      onError,
    );

    expect(onError).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(expect.objectContaining({
      passed: true,
      verdict: 'accepted',
      actualOutput: { kept: [1, 0] },
    }));
  });
});
