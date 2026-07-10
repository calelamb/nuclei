import { describe, expect, it } from 'vitest';
import type { Gate } from '../../types/quantum';
import type { KernelPort, ParseOutcome, SimOutcome } from './interfaces';
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

function makeCtx(kernel: KernelPort = makeFakeKernel()): { ctx: ToolContext; workspace: InMemoryWorkspace } {
  const workspace = new InMemoryWorkspace([
    { path: FILE_PATH, framework: 'qiskit', content: BELL_CODE, dirty: false },
  ]);
  const ctx: ToolContext = {
    workspace,
    kernel,
    lastSim: {},
    resolveFramework: defaultFrameworkResolver(workspace),
    lastKnownHash: new Map(),
  };
  return { ctx, workspace };
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
