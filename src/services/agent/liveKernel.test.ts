import { describe, expect, it } from 'vitest';
import type { KernelTransport } from './liveKernel';
import { SessionKernel } from './liveKernel';

interface SentAgentExecute {
  type: 'agent_execute';
  request_id: string;
  action: string;
  framework: string;
  language: string;
  code: string;
  shots?: number;
}

function makeFakeTransport(): {
  transport: KernelTransport;
  sent: SentAgentExecute[];
  push: (msg: unknown) => void;
} {
  const sent: SentAgentExecute[] = [];
  let handler: ((msg: unknown) => void) | null = null;
  const transport: KernelTransport = {
    send(message: object) {
      sent.push(message as SentAgentExecute);
    },
    onMessage(h) {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
  return {
    transport,
    sent,
    push: (msg: unknown) => handler?.(msg),
  };
}

function qiskitFramework(): 'qiskit' {
  return 'qiskit';
}

describe('SessionKernel (agent_execute protocol)', () => {
  it('parse sends an agent_execute request tagged with the resolved framework and resolves on its agent_result', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.parse('code', 'python');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'agent_execute',
      action: 'parse',
      framework: 'qiskit',
      language: 'python',
      code: 'code',
    });
    const requestId = sent[0].request_id;
    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);

    push({
      type: 'agent_result',
      request_id: requestId,
      status: 'ok',
      snapshot: { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 0, gates: [] },
      result: null,
      stdout: '',
      stderr: '',
      error: null,
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.snapshot.qubit_count).toBe(1);
  });

  it('parse resolves ok:false on an error status', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.parse('bad code', 'python');
    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'error',
      snapshot: null,
      result: null,
      stdout: '',
      stderr: '',
      error: { message: 'SyntaxError: invalid syntax' },
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toBe('SyntaxError: invalid syntax');
  });

  it('simulate sends shots and resolves on its agent_result', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.simulate('code', 512, 'python');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'agent_execute', action: 'simulate', shots: 512, code: 'code' });

    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'ok',
      snapshot: null,
      result: {
        state_vector: [],
        probabilities: { '0': 1 },
        measurements: {},
        bloch_coords: [],
        execution_time_ms: 1,
        shot_count: 512,
      },
      stdout: '',
      stderr: '',
      error: null,
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.shot_count).toBe(512);
  });

  it('simulate resolves ok:false on an error status', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.simulate('code', 100, 'python');
    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'error',
      snapshot: null,
      result: null,
      stdout: '',
      stderr: 'boom',
      error: { message: 'ZeroDivisionError' },
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toBe('ZeroDivisionError');
  });

  it('supports multiple concurrent in-flight requests, correlated by request_id', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const first = kernel.parse('code-a', 'python');
    const second = kernel.parse('code-b', 'python');
    expect(sent).toHaveLength(2);
    const [idA, idB] = sent.map((s) => s.request_id);
    expect(idA).not.toBe(idB);

    // Resolve out of order — second request's result arrives first.
    push({
      type: 'agent_result',
      request_id: idB,
      status: 'ok',
      snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 0, depth: 0, gates: [] },
      result: null,
      stdout: '',
      stderr: '',
      error: null,
    });
    push({
      type: 'agent_result',
      request_id: idA,
      status: 'ok',
      snapshot: { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 0, gates: [] },
      result: null,
      stdout: '',
      stderr: '',
      error: null,
    });

    const [outcomeA, outcomeB] = await Promise.all([first, second]);
    if (!outcomeA.ok || !outcomeB.ok) throw new Error('expected ok');
    expect(outcomeA.snapshot.qubit_count).toBe(1);
    expect(outcomeB.snapshot.qubit_count).toBe(2);
  });

  it('ignores agent_result messages for unknown or already-settled request ids', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.parse('code', 'python');
    push({ type: 'agent_result', request_id: 'not-a-real-id', status: 'ok', snapshot: null, result: null, stdout: '', stderr: '', error: null });
    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'ok',
      snapshot: { framework: 'qiskit', qubit_count: 3, classical_bit_count: 0, depth: 0, gates: [] },
      result: null,
      stdout: '',
      stderr: '',
      error: null,
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.snapshot.qubit_count).toBe(3);
  });

  it('ignores unrelated / malformed messages entirely', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.parse('code', 'python');
    push({ type: 'hardware_connected_providers', providers: [] });
    push(null);
    push('not an object');
    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'ok',
      snapshot: { framework: 'qiskit', qubit_count: 3, classical_bit_count: 0, depth: 0, gates: [] },
      result: null,
      stdout: '',
      stderr: '',
      error: null,
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
  });

  it('transpile sends a qiskit/python agent_execute request with the target fields and resolves metrics on ok', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.transpile('code', { basisGates: ['u', 'cx'], couplingMap: [[0, 1]], optimizationLevel: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'agent_execute',
      action: 'transpile',
      framework: 'qiskit',
      language: 'python',
      code: 'code',
      basis_gates: ['u', 'cx'],
      coupling_map: [[0, 1]],
      optimization_level: 2,
    });

    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'ok',
      snapshot: null,
      result: {
        depth: 3,
        gate_counts: { u: 2, cx: 1 },
        two_qubit_count: 1,
        num_qubits: 2,
        basis_gates: ['u', 'cx'],
        coupling_mapped: true,
      },
      stdout: '',
      stderr: '',
      error: null,
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.metrics).toEqual({
      depth: 3,
      gateCounts: { u: 2, cx: 1 },
      twoQubitCount: 1,
      numQubits: 2,
      couplingMapped: true,
    });
  });

  it('transpile resolves ok:false on an error status, without a snapshot/simulate-style line field', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.transpile('bad code', {});
    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'error',
      snapshot: null,
      result: null,
      stdout: '',
      stderr: '',
      error: { code: 'transpile_unsupported_framework', message: 'Transpilation preview currently supports Qiskit circuits.' },
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toBe('Transpilation preview currently supports Qiskit circuits.');
    expect('line' in outcome).toBe(false);
  });

  it('transpile resolves ok:false when the kernel returns an empty result', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);

    const promise = kernel.transpile('code', {});
    push({
      type: 'agent_result',
      request_id: sent[0].request_id,
      status: 'ok',
      snapshot: null,
      result: null,
      stdout: '',
      stderr: '',
      error: null,
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toMatch(/empty transpile result/i);
  });

  it('times out if the kernel never responds', async () => {
    const { transport } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework, 20);

    const outcome = await kernel.parse('code', 'python');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toMatch(/timed out/i);
  });

  it('dispose unsubscribes from the transport', async () => {
    const { transport, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport, qiskitFramework);
    kernel.dispose();

    // After dispose, pushing a message must not throw and must not resolve
    // any (nonexistent) pending request — nothing to assert on outcome
    // beyond "no crash", since there is no in-flight promise.
    expect(() => push({ type: 'agent_result', request_id: 'x', status: 'ok', snapshot: null, result: null, stdout: '', stderr: '', error: null })).not.toThrow();
  });
});
