import { describe, expect, it } from 'vitest';
import type { BackendInfo } from '../../types/hardware';
import type { Gate } from '../../types/quantum';
import { BudgetLedger } from './budgetLedger';
import type { KernelPort, ParseOutcome, SimOutcome } from './interfaces';
import { DEFAULT_POLICY } from './policy';
import type { AutonomyPolicy, SubmissionFacts } from './policy';
import { FakeSubmitPort } from './submitPort';
import type { SubmitPort } from './submitPort';
import { defaultFrameworkResolver, executeTool } from './toolExecutors';
import type { ToolContext } from './toolExecutors';
import { InMemoryWorkspace } from './workspace';

const FILE_PATH = 'main.py';
const BELL_CODE = 'from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\n';

const BELL_GATES: Gate[] = [
  { type: 'H', targets: [0], controls: [], params: [], layer: 0 },
  { type: 'CNOT', targets: [1], controls: [0], params: [], layer: 1 },
  { type: 'measure', targets: [0], controls: [], params: [], layer: 2 },
  { type: 'measure', targets: [1], controls: [], params: [], layer: 2 },
];

function makeFakeKernel(overrides: Partial<KernelPort> = {}): KernelPort {
  return {
    parse: async (): Promise<ParseOutcome> => ({
      ok: true,
      snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 2, depth: 1, gates: [] },
    }),
    simulate: async (_code: string, shots: number): Promise<SimOutcome> => ({
      ok: true,
      result: {
        state_vector: [],
        probabilities: { '00': 0.5, '11': 0.5 },
        measurements: {},
        bloch_coords: [],
        execution_time_ms: 3,
        shot_count: shots,
      },
    }),
    ...overrides,
  };
}

function makeCtx(
  kernel: KernelPort = makeFakeKernel(),
  getBackends?: () => BackendInfo[],
): { ctx: ToolContext; workspace: InMemoryWorkspace } {
  const workspace = new InMemoryWorkspace([
    { path: FILE_PATH, framework: 'qiskit', content: BELL_CODE, dirty: false },
  ]);
  const ctx: ToolContext = {
    workspace,
    kernel,
    lastSim: {},
    resolveFramework: defaultFrameworkResolver(workspace),
    lastKnownHash: new Map(),
    getBackends,
  };
  return { ctx, workspace };
}

interface HardwareCtxOptions {
  kernel?: KernelPort;
  getBackends?: () => BackendInfo[];
  submitPort?: SubmitPort;
  policy?: AutonomyPolicy;
  ledger?: BudgetLedger;
  estimateCost?: (facts: SubmissionFacts) => number | null;
}

/** Like makeCtx, but exposes the full hardware-submission dependency set
 * (submitPort/policy/ledger/estimateCost) for testing submit_hardware_job
 * and friends. */
function makeHardwareCtx(opts: HardwareCtxOptions = {}): { ctx: ToolContext; workspace: InMemoryWorkspace } {
  const kernel = opts.kernel ?? makeFakeKernel();
  const workspace = new InMemoryWorkspace([
    { path: FILE_PATH, framework: 'qiskit', content: BELL_CODE, dirty: false },
  ]);
  const ctx: ToolContext = {
    workspace,
    kernel,
    lastSim: {},
    lastSnapshot: {},
    resolveFramework: defaultFrameworkResolver(workspace),
    lastKnownHash: new Map(),
    getBackends: opts.getBackends,
    submitPort: opts.submitPort,
    policy: opts.policy,
    ledger: opts.ledger,
    estimateCost: opts.estimateCost,
  };
  return { ctx, workspace };
}

/** Kernel whose parse() returns a correct 2-qubit Bell circuit snapshot and
 * whose simulate() returns the given probabilities — lets tests drive
 * check_algorithm_invariant against a "correct" or "wrong" simulation of
 * the same classified circuit. */
function makeBellKernel(probabilities: Record<string, number> = { '00': 0.5, '11': 0.5 }): KernelPort {
  return {
    parse: async (): Promise<ParseOutcome> => ({
      ok: true,
      snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 2, depth: 3, gates: BELL_GATES },
    }),
    simulate: async (_code: string, shots: number): Promise<SimOutcome> => ({
      ok: true,
      result: {
        state_vector: [],
        probabilities,
        measurements: {},
        bloch_coords: [],
        execution_time_ms: 3,
        shot_count: shots,
      },
    }),
  };
}

function makeBackend(overrides: Partial<BackendInfo> = {}): BackendInfo {
  return {
    name: 'test-backend',
    provider: 'ibm',
    qubitCount: 5,
    connectivity: [],
    queueLength: 2,
    averageErrorRate: 0.01,
    gateSet: ['h', 'cx', 'measure'],
    status: 'online',
    ...overrides,
  };
}

describe('executeTool', () => {
  it('inspect_project lists files and the active path', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('inspect_project', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.activePath).toBe(FILE_PATH);
    expect(evidence.facts.files).toEqual([{ path: FILE_PATH, framework: 'qiskit', dirty: false }]);
  });

  it('read_quantum_file returns file contents', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('read_quantum_file', { path: FILE_PATH }, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.content).toBe(BELL_CODE);
  });

  it('read_quantum_file fails without throwing when path is missing', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('read_quantum_file', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
    expect(evidence.diagnostics).toMatch(/path/i);
  });

  it('read_quantum_file fails for an unknown path', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('read_quantum_file', { path: 'missing.py' }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('apply_patch writes new content and tracks the hash', async () => {
    const { ctx, workspace } = makeCtx();
    const evidence = await executeTool(
      'apply_patch',
      { path: FILE_PATH, new_content: 'print(1)\n', rationale: 'simplify' },
      ctx,
      'tc1',
    );
    expect(evidence.ok).toBe(true);
    expect(workspace.readFile(FILE_PATH)?.content).toBe('print(1)\n');
    expect(ctx.lastKnownHash.get(FILE_PATH)).toBe(evidence.facts.afterHash);
  });

  it('apply_patch fails without throwing on malformed input', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('apply_patch', { path: FILE_PATH }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('apply_patch surfaces a conflict against the tracked hash instead of throwing', async () => {
    const { ctx } = makeCtx();
    ctx.lastKnownHash.set(FILE_PATH, 'stale-hash-from-before');
    const evidence = await executeTool(
      'apply_patch',
      { path: FILE_PATH, new_content: 'print(2)\n', rationale: 'update' },
      ctx,
      'tc1',
    );
    expect(evidence.ok).toBe(false);
    expect(evidence.facts.conflict).toBe(true);
  });

  it('rollback_patch reverts a prior apply_patch', async () => {
    const { ctx, workspace } = makeCtx();
    const applied = await executeTool(
      'apply_patch',
      { path: FILE_PATH, new_content: 'print(1)\n', rationale: 'x' },
      ctx,
      'tc1',
    );
    const txnId = applied.facts.transactionId as string;
    const evidence = await executeTool('rollback_patch', { transaction_id: txnId }, ctx, 'tc2');
    expect(evidence.ok).toBe(true);
    expect(workspace.readFile(FILE_PATH)?.content).toBe(BELL_CODE);
  });

  it('rollback_patch fails without throwing for an unknown transaction id', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('rollback_patch', { transaction_id: 'nope' }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('parse_quantum_program returns snapshot facts on success', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('parse_quantum_program', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.qubitCount).toBe(2);
  });

  it('parse_quantum_program surfaces kernel diagnostics on failure', async () => {
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({ ok: false, error: 'SyntaxError: bad', line: 3 }),
    });
    const { ctx } = makeCtx(kernel);
    const evidence = await executeTool('parse_quantum_program', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
    expect(evidence.diagnostics).toBe('SyntaxError: bad');
    expect(evidence.facts.line).toBe(3);
  });

  it('run_simulation stores the result on ctx.lastSim for later comparison', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('run_simulation', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(ctx.lastSim.result?.probabilities).toEqual({ '00': 0.5, '11': 0.5 });
  });

  it('run_simulation rejects a non-numeric shots value without throwing', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('run_simulation', { shots: 'lots' }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('compare_quantum_results reports a match within tolerance', async () => {
    const { ctx } = makeCtx();
    await executeTool('run_simulation', {}, ctx, 'tc1');
    const evidence = await executeTool(
      'compare_quantum_results',
      { expected_probabilities: { '00': 0.5, '11': 0.5 } },
      ctx,
      'tc2',
    );
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.matches).toBe(true);
    expect(evidence.facts.worstDelta).toBe(0);
    expect(evidence.facts.totalVariationDistance).toBe(0);
    expect(evidence.facts.perState).toEqual({
      '00': { expected: 0.5, actual: 0.5, delta: 0 },
      '11': { expected: 0.5, actual: 0.5, delta: 0 },
    });
    expect(Array.isArray(evidence.facts.perStateOrdered)).toBe(true);
  });

  it('compare_quantum_results reports a mismatch outside tolerance', async () => {
    const { ctx } = makeCtx();
    await executeTool('run_simulation', {}, ctx, 'tc1');
    const evidence = await executeTool(
      'compare_quantum_results',
      { expected_probabilities: { '00': 1.0 }, tolerance: 0.01 },
      ctx,
      'tc2',
    );
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.matches).toBe(false);
    expect(evidence.facts.totalVariationDistance).toBeCloseTo(0.5);
  });

  it('compare_quantum_results fails without throwing when no simulation has run yet', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool(
      'compare_quantum_results',
      { expected_probabilities: { '00': 1 } },
      ctx,
      'tc1',
    );
    expect(evidence.ok).toBe(false);
  });

  it('check_algorithm_invariant reports checked:false with a reason when no simulation has run yet', async () => {
    const { ctx } = makeHardwareCtx({ kernel: makeBellKernel() });
    const evidence = await executeTool('check_algorithm_invariant', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.checked).toBe(false);
    expect(evidence.facts.reason).toMatch(/run a simulation/i);
  });

  it('check_algorithm_invariant auto-classifies a Bell circuit and matches a correct simulation', async () => {
    const { ctx } = makeHardwareCtx({ kernel: makeBellKernel({ '00': 0.5, '11': 0.5 }) });
    await executeTool('parse_quantum_program', {}, ctx, 'tc1');
    await executeTool('run_simulation', {}, ctx, 'tc2');
    const evidence = await executeTool('check_algorithm_invariant', {}, ctx, 'tc3');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.checked).toBe(true);
    expect(evidence.facts.algorithm).toBe('bell');
    expect(evidence.facts.matches).toBe(true);
    expect(evidence.facts.expected).toEqual({ '00': 0.5, '11': 0.5 });
  });

  it('check_algorithm_invariant flags a mismatch when the simulation diverges from the Bell reference', async () => {
    const { ctx } = makeHardwareCtx({ kernel: makeBellKernel({ '00': 1.0 }) });
    await executeTool('parse_quantum_program', {}, ctx, 'tc1');
    await executeTool('run_simulation', {}, ctx, 'tc2');
    const evidence = await executeTool('check_algorithm_invariant', {}, ctx, 'tc3');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.checked).toBe(true);
    expect(evidence.facts.algorithm).toBe('bell');
    expect(evidence.facts.matches).toBe(false);
  });

  it('check_algorithm_invariant reports checked:false for an algorithm with no fixed reference distribution', async () => {
    const { ctx } = makeHardwareCtx({ kernel: makeBellKernel() });
    await executeTool('run_simulation', {}, ctx, 'tc1');
    const evidence = await executeTool('check_algorithm_invariant', { algorithm: 'teleportation' }, ctx, 'tc2');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.checked).toBe(false);
    expect(evidence.facts.algorithm).toBe('teleportation');
    expect(evidence.facts.reason).toMatch(/no fixed reference distribution/i);
  });

  it('check_algorithm_invariant rejects an invalid algorithm override without throwing', async () => {
    const { ctx } = makeHardwareCtx({ kernel: makeBellKernel() });
    await executeTool('run_simulation', {}, ctx, 'tc1');
    const evidence = await executeTool('check_algorithm_invariant', { algorithm: 'shor' }, ctx, 'tc2');
    expect(evidence.ok).toBe(false);
  });

  it('check_algorithm_invariant rejects a non-numeric tolerance without throwing', async () => {
    const { ctx } = makeHardwareCtx({ kernel: makeBellKernel() });
    await executeTool('run_simulation', {}, ctx, 'tc1');
    const evidence = await executeTool('check_algorithm_invariant', { tolerance: 'loose' }, ctx, 'tc2');
    expect(evidence.ok).toBe(false);
  });

  it('estimate_quantum_resources returns resource facts on a successful parse', async () => {
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({
        ok: true,
        snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 2, depth: 3, gates: BELL_GATES },
      }),
    });
    const { ctx } = makeCtx(kernel);
    const evidence = await executeTool('estimate_quantum_resources', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.qubitCount).toBe(2);
    expect(evidence.facts.gateCount).toBe(4);
    expect(evidence.facts.twoQubitGateCount).toBe(1);
    expect(evidence.facts.gateHistogram).toEqual({ H: 1, CNOT: 1, MEASURE: 2 });
  });

  it('estimate_quantum_resources surfaces kernel diagnostics on a parse failure', async () => {
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({ ok: false, error: 'SyntaxError: bad', line: 2 }),
    });
    const { ctx } = makeCtx(kernel);
    const evidence = await executeTool('estimate_quantum_resources', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
    expect(evidence.diagnostics).toBe('SyntaxError: bad');
  });

  it('estimate_quantum_resources fails without throwing for an unknown path', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('estimate_quantum_resources', { path: 'missing.py' }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('validate_quantum_program returns zero diagnostics for a correct Bell circuit', async () => {
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({
        ok: true,
        snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 2, depth: 3, gates: BELL_GATES },
      }),
    });
    const { ctx } = makeCtx(kernel);
    const evidence = await executeTool('validate_quantum_program', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.diagnostics).toEqual([]);
    expect(evidence.facts.errorCount).toBe(0);
    expect(evidence.facts.warningCount).toBe(0);
    expect(evidence.diagnostics).toBeUndefined();
  });

  it('validate_quantum_program reports errors for an out-of-range qubit without throwing', async () => {
    const badGates: Gate[] = [{ type: 'X', targets: [9], controls: [], params: [], layer: 0 }];
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({
        ok: true,
        snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 0, depth: 1, gates: badGates },
      }),
    });
    const { ctx } = makeCtx(kernel);
    const evidence = await executeTool('validate_quantum_program', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.errorCount).toBe(1);
    expect(evidence.diagnostics).toMatch(/qubit_out_of_range/);
  });

  it('validate_quantum_program surfaces kernel diagnostics on a parse failure', async () => {
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({ ok: false, error: 'SyntaxError: bad', line: 5 }),
    });
    const { ctx } = makeCtx(kernel);
    const evidence = await executeTool('validate_quantum_program', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
    expect(evidence.diagnostics).toBe('SyntaxError: bad');
  });

  it('validate_quantum_program fails without throwing for an unknown path', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('validate_quantum_program', { path: 'missing.py' }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('plan_hardware_run reports unavailable when no getBackends is provided', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('plan_hardware_run', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.available).toBe(false);
  });

  it('plan_hardware_run reports unavailable when getBackends returns an empty list', async () => {
    const { ctx } = makeCtx(makeFakeKernel(), () => []);
    const evidence = await executeTool('plan_hardware_run', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.available).toBe(false);
  });

  it('plan_hardware_run returns a selected/candidates shape with a mock getBackends', async () => {
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({
        ok: true,
        snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 2, depth: 3, gates: BELL_GATES },
      }),
    });
    const backend = makeBackend({ name: 'ibm-brisbane' });
    const { ctx } = makeCtx(kernel, () => [backend]);
    const evidence = await executeTool('plan_hardware_run', {}, ctx, 'tc1');

    expect(evidence.ok).toBe(true);
    expect(evidence.facts.available).toBe(true);
    expect(evidence.facts.selected).toBe('ibm-brisbane');
    expect(Array.isArray(evidence.facts.candidates)).toBe(true);
    expect(evidence.facts.candidates).toEqual([{ name: 'ibm-brisbane', provider: 'ibm', score: expect.any(Number) }]);
    expect(evidence.facts.rejected).toEqual([]);
    expect(typeof evidence.facts.rationale).toBe('string');
  });

  it('plan_hardware_run fails without throwing on a parse error', async () => {
    const kernel = makeFakeKernel({
      parse: async (): Promise<ParseOutcome> => ({ ok: false, error: 'SyntaxError: bad', line: 1 }),
    });
    const { ctx } = makeCtx(kernel, () => [makeBackend()]);
    const evidence = await executeTool('plan_hardware_run', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
    expect(evidence.diagnostics).toBe('SyntaxError: bad');
  });

  it('plan_hardware_run fails without throwing for an unknown path', async () => {
    const { ctx } = makeCtx(makeFakeKernel(), () => [makeBackend()]);
    const evidence = await executeTool('plan_hardware_run', { path: 'missing.py' }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('finish requires summary and success', async () => {
    const { ctx } = makeCtx();
    const good = await executeTool('finish', { summary: 'done', success: true }, ctx, 'tc1');
    expect(good.ok).toBe(true);

    const missing = await executeTool('finish', { summary: 'done' }, ctx, 'tc2');
    expect(missing.ok).toBe(false);
  });

  it('an unknown tool returns ok:false evidence instead of throwing', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('teleport_qubit', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
    expect(evidence.diagnostics).toMatch(/unknown tool/i);
  });

  it('malformed (non-object) input never throws', async () => {
    const { ctx } = makeCtx();
    const evidence = await executeTool('read_quantum_file', 'not-an-object', ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });
});

describe('executeTool — hardware submission (safety-critical)', () => {
  it(
    'submit_hardware_job under DEFAULT_POLICY returns needs_approval for a real QPU backend and NEVER ' +
      'calls the submit port — the core safety invariant',
    async () => {
      const submitPort = new FakeSubmitPort();
      const qpuBackend = makeBackend({ name: 'ibm-brisbane', provider: 'ibm' });
      const { ctx } = makeHardwareCtx({ getBackends: () => [qpuBackend], submitPort, policy: DEFAULT_POLICY });

      const evidence = await executeTool(
        'submit_hardware_job',
        { backend: 'ibm-brisbane', shots: 100 },
        ctx,
        'tc1',
      );

      expect(evidence.ok).toBe(true);
      expect(evidence.facts.submitted).toBe(false);
      expect(evidence.facts.decision).toBe('needs_approval');
      expect(Array.isArray(evidence.facts.reasons)).toBe(true);
      expect((evidence.facts.reasons as string[]).length).toBeGreaterThan(0);
      expect(submitPort.submissions).toHaveLength(0);
    },
  );

  it('submit_hardware_job under DEFAULT_POLICY allows and submits a simulator backend', async () => {
    const submitPort = new FakeSubmitPort();
    const simBackend = makeBackend({ name: 'local-sim', provider: 'simulator' });
    const { ctx } = makeHardwareCtx({ getBackends: () => [simBackend], submitPort, policy: DEFAULT_POLICY });

    const evidence = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 256 }, ctx, 'tc1');

    expect(evidence.ok).toBe(true);
    expect(evidence.facts.submitted).toBe(true);
    expect(evidence.facts.decision).toBe('allow');
    expect(typeof evidence.facts.jobId).toBe('string');
    expect(submitPort.submissions).toHaveLength(1);
    expect(submitPort.submissions[0]).toMatchObject({ provider: 'simulator', backend: 'local-sim', shots: 256 });
  });

  it('submit_hardware_job de-duplicates an identical repeated allowed submission via the ledger', async () => {
    const submitPort = new FakeSubmitPort();
    const simBackend = makeBackend({ name: 'local-sim', provider: 'simulator' });
    const ledger = new BudgetLedger(1000);
    const { ctx } = makeHardwareCtx({
      getBackends: () => [simBackend],
      submitPort,
      policy: DEFAULT_POLICY,
      ledger,
    });

    const first = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 100 }, ctx, 'tc1');
    expect(first.facts.submitted).toBe(true);

    const second = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 100 }, ctx, 'tc2');
    expect(second.ok).toBe(true);
    expect(second.facts.submitted).toBe(false);
    expect(second.facts.decision).toBe('duplicate');
    expect(second.facts.jobId).toBe(first.facts.jobId);

    // Still exactly one real submission — the duplicate never reached the port.
    expect(submitPort.submissions).toHaveLength(1);
  });

  it('submit_hardware_job fails without throwing for an unknown backend, and never touches the submit port', async () => {
    const submitPort = new FakeSubmitPort();
    const { ctx } = makeHardwareCtx({ getBackends: () => [], submitPort, policy: DEFAULT_POLICY });

    const evidence = await executeTool('submit_hardware_job', { backend: 'nope', shots: 10 }, ctx, 'tc1');

    expect(evidence.ok).toBe(false);
    expect(submitPort.submissions).toHaveLength(0);
  });

  it('submit_hardware_job reports "unavailable" when allowed but no submitPort is configured', async () => {
    const simBackend = makeBackend({ name: 'local-sim', provider: 'simulator' });
    const { ctx } = makeHardwareCtx({ getBackends: () => [simBackend], policy: DEFAULT_POLICY });

    const evidence = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 10 }, ctx, 'tc1');

    expect(evidence.ok).toBe(true);
    expect(evidence.facts.submitted).toBe(false);
    expect(evidence.facts.decision).toBe('unavailable');
  });

  it('submit_hardware_job fails without throwing on malformed input', async () => {
    const { ctx } = makeHardwareCtx();
    const evidence = await executeTool('submit_hardware_job', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('poll_hardware_job reports status and queue position via the submit port', async () => {
    const submitPort = new FakeSubmitPort();
    const simBackend = makeBackend({ name: 'local-sim', provider: 'simulator' });
    const { ctx } = makeHardwareCtx({ getBackends: () => [simBackend], submitPort, policy: DEFAULT_POLICY });

    const submitted = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 10 }, ctx, 'tc1');
    const jobId = submitted.facts.jobId as string;
    submitPort.setStatus(jobId, 'running', 3);

    const evidence = await executeTool('poll_hardware_job', { job_id: jobId }, ctx, 'tc2');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.status).toBe('running');
    expect(evidence.facts.queuePosition).toBe(3);
  });

  it('poll_hardware_job reports unavailable without a submitPort, without throwing', async () => {
    const { ctx } = makeHardwareCtx();
    const evidence = await executeTool('poll_hardware_job', { job_id: 'job-1' }, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.available).toBe(false);
  });

  it('poll_hardware_job fails without throwing when job_id is missing', async () => {
    const { ctx } = makeHardwareCtx({ submitPort: new FakeSubmitPort() });
    const evidence = await executeTool('poll_hardware_job', {}, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });

  it('cancel_hardware_job cancels a pending job via the submit port', async () => {
    const submitPort = new FakeSubmitPort();
    const simBackend = makeBackend({ name: 'local-sim', provider: 'simulator' });
    const { ctx } = makeHardwareCtx({ getBackends: () => [simBackend], submitPort, policy: DEFAULT_POLICY });

    const submitted = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 10 }, ctx, 'tc1');
    const jobId = submitted.facts.jobId as string;

    const evidence = await executeTool('cancel_hardware_job', { job_id: jobId }, ctx, 'tc2');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.cancelled).toBe(true);
  });

  it('cancel_hardware_job reports unavailable without a submitPort, without throwing', async () => {
    const { ctx } = makeHardwareCtx();
    const evidence = await executeTool('cancel_hardware_job', { job_id: 'job-1' }, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.available).toBe(false);
  });

  it('analyze_hardware_result reports probabilities and an expected-distribution comparison', async () => {
    const submitPort = new FakeSubmitPort();
    const simBackend = makeBackend({ name: 'local-sim', provider: 'simulator' });
    const { ctx } = makeHardwareCtx({ getBackends: () => [simBackend], submitPort, policy: DEFAULT_POLICY });

    const submitted = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 10 }, ctx, 'tc1');
    const jobId = submitted.facts.jobId as string;
    submitPort.setResult(jobId, { jobId, probabilities: { '00': 0.5, '11': 0.5 } });

    const evidence = await executeTool(
      'analyze_hardware_result',
      { job_id: jobId, expected_probabilities: { '00': 0.5, '11': 0.5 } },
      ctx,
      'tc2',
    );

    expect(evidence.ok).toBe(true);
    expect(evidence.facts.probabilities).toEqual({ '00': 0.5, '11': 0.5 });
    expect(evidence.facts.comparison).toBeDefined();
    expect((evidence.facts.comparison as { matches: boolean }).matches).toBe(true);
  });

  it('analyze_hardware_result omits comparison when no expected distribution is given', async () => {
    const submitPort = new FakeSubmitPort();
    const simBackend = makeBackend({ name: 'local-sim', provider: 'simulator' });
    const { ctx } = makeHardwareCtx({ getBackends: () => [simBackend], submitPort, policy: DEFAULT_POLICY });

    const submitted = await executeTool('submit_hardware_job', { backend: 'local-sim', shots: 10 }, ctx, 'tc1');
    const jobId = submitted.facts.jobId as string;
    submitPort.setResult(jobId, { jobId, probabilities: { '00': 1 } });

    const evidence = await executeTool('analyze_hardware_result', { job_id: jobId }, ctx, 'tc2');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.comparison).toBeUndefined();
  });

  it('analyze_hardware_result reports unavailable without a submitPort, without throwing', async () => {
    const { ctx } = makeHardwareCtx();
    const evidence = await executeTool('analyze_hardware_result', { job_id: 'job-1' }, ctx, 'tc1');
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.available).toBe(false);
  });

  it('analyze_hardware_result surfaces an error for an unknown job without throwing', async () => {
    const submitPort = new FakeSubmitPort();
    const { ctx } = makeHardwareCtx({ submitPort, policy: DEFAULT_POLICY });

    const evidence = await executeTool('analyze_hardware_result', { job_id: 'nope' }, ctx, 'tc1');
    expect(evidence.ok).toBe(false);
  });
});
