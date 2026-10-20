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

  it('does not leave the reference circuit in the namespace after fidelity (the kernel snapshots the last circuit)', () => {
    const code = buildTestCode(
      'def solve(bell_index):\n    from qiskit import QuantumCircuit\n    return QuantumCircuit(2, 2)\n',
      { ...baseChallenge, referenceCode: 'from qiskit import QuantumCircuit\n\ndef reference(bell_index):\n    return QuantumCircuit(2, 2)\n' },
      { bell_index: 0 },
      'qiskit',
    );
    expect(code.lastIndexOf('__nuclei_ref_circuit = None')).toBeGreaterThan(code.lastIndexOf('= reference('));
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
    expect(results[0].message).not.toContain('Connection error');
    expect(results[0].verdict).toBe('runtime_error');
  });

  it("marks every case 'engine unavailable' (not run, not scored) when Python never started (learn-r10-02)", async () => {
    const { createKernelSession } = await import('./kernelSession');
    vi.mocked(createKernelSession).mockRejectedValue(
      new Error("Couldn't start the browser Python engine. Check your connection or content blocker, then retry."),
    );
    const testCases: TestCase[] = [{
      id: 'tc-1', label: 'Case 1', description: 'd', params: {},
      validation: { type: 'state_fidelity' }, hidden: false, weight: 1,
    }];

    const results = await runTestCases(
      'x', { ...baseChallenge, testCases }, testCases, 'qiskit', 'web', 1024, vi.fn(), vi.fn(), vi.fn(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].engineUnavailable).toBe(true);
    expect(results[0].message).toContain("Python didn't start");
    expect(results[0].message).not.toMatch(/kernel/i);
  });

  describe('code errors (learn-r10-03)', () => {
    const cases: TestCase[] = [0, 1].map((n) => ({
      id: `tc-${n}`, label: `Case ${n}`, description: 'd', params: { bell_index: n },
      validation: { type: 'state_fidelity' } as const, hidden: false, weight: 1,
    }));
    const userCode = 'from qiskit import QuantumCircuit\ndef solve(bell_index):\n    qc.h(0))\n';

    async function runWithError(message: string, traceback: string) {
      const { createKernelSession } = await import('./kernelSession');
      vi.mocked(createKernelSession).mockImplementation(async (_platform, onMessage) => ({
        send: vi.fn(() => { onMessage({ type: 'error', message, traceback, phase: 'execute', code: 'execution_error' }); }),
        close: vi.fn(),
      }));
      return runTestCases(userCode, { ...baseChallenge, testCases: cases }, cases, 'qiskit', 'web', 1024, vi.fn(), vi.fn(), vi.fn());
    }

    it("reports the student's own line (harness lines subtracted) and drops the verdict prefix", async () => {
      // The harness puts one comment line before the student's code, so wrapped line 4 is student line 3.
      const results = await runWithError("SyntaxError: unmatched ')'", '  File "<string>", line 4\n    qc.h(0))\nSyntaxError: unmatched \')\'');
      expect(results.map((r) => r.verdict)).toEqual(['compile_error', 'compile_error']);
      expect(results[0].message).toBe("SyntaxError: unmatched ')'");
      expect(results[0].errorLine).toBe(3);
      expect(results[0].engineUnavailable).toBeUndefined();
    });

    it('gives no line when the error sits in the harness after the student code', async () => {
      const results = await runWithError('TypeError: solve(...) must return a QuantumCircuit', '  File "<string>", line 40, in <module>');
      expect(results[0].verdict).toBe('runtime_error');
      expect(results[0].errorLine).toBeUndefined();
    });
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

  describe('browser (web) circuit challenges', () => {
    const testCase: TestCase = {
      id: 'tc-1', label: 'Case', description: 'd', params: { bell_index: 0 },
      validation: { type: 'state_fidelity' }, hidden: false, weight: 1,
    };

    it('lets Qiskit circuit challenges run on web instead of refusing them', async () => {
      const { createKernelSession } = await import('./kernelSession');
      const send = vi.fn((message: { type: string }) => {
        expect(message.type).toBe('execute');
      });
      vi.mocked(createKernelSession).mockImplementation(async () => ({ send, close: vi.fn() }));

      void runTestCases(
        'def solve(bell_index):\n    pass\n',
        { ...baseChallenge, testCases: [testCase] },
        [testCase], 'qiskit', 'web', 1024, vi.fn(), vi.fn(), vi.fn(),
      );
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    });

    it('aborts the session when a test overruns, so a runaway solution cannot keep Python busy', async () => {
      vi.useFakeTimers();
      try {
        const { createKernelSession } = await import('./kernelSession');
        const abort = vi.fn();
        vi.mocked(createKernelSession).mockImplementation(async () => ({
          send: vi.fn(), // never answers
          close: vi.fn(),
          abort,
        }));
        const promise = runTestCases(
          'def solve(bell_index):\n    pass\n',
          { ...baseChallenge, testCases: [testCase] },
          [testCase], 'qiskit', 'web', 1024, vi.fn(), vi.fn(), vi.fn(),
        );
        await vi.advanceTimersByTimeAsync(36_000);
        const results = await promise;
        expect(results[0].verdict).toBe('time_limit_exceeded');
        expect(abort).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks features outside the browser subset as unsupported, not as a failed attempt', async () => {
      const { createKernelSession } = await import('./kernelSession');
      vi.mocked(createKernelSession).mockImplementation(async (_platform, onMessage) => ({
        send: vi.fn(() => {
          onMessage({
            type: 'error',
            phase: 'execute',
            code: 'unsupported_framework',
            message: "qiskit_aer.noise.NoiseModel isn't available in the browser version of Qiskit",
          });
        }),
        close: vi.fn(),
      }));
      const onError = vi.fn();

      const results = await runTestCases(
        'def solve(bell_index):\n    pass\n',
        { ...baseChallenge, testCases: [testCase] },
        [testCase], 'qiskit', 'web', 1024, vi.fn(), vi.fn(), onError,
      );

      expect(results[0]).toMatchObject({ passed: false, unsupported: true });
      expect(results[0].message).toContain('Not supported in the browser');
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });
});
