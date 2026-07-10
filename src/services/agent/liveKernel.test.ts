import { describe, expect, it } from 'vitest';
import type { KernelMessage, KernelResponse } from '../../types/quantum';
import type { KernelTransport } from './liveKernel';
import { SessionKernel } from './liveKernel';

function makeFakeTransport(): {
  transport: KernelTransport;
  sent: KernelMessage[];
  push: (msg: KernelResponse) => void;
} {
  const sent: KernelMessage[] = [];
  let handler: ((msg: KernelResponse) => void) | null = null;
  const transport: KernelTransport = {
    send(message: KernelMessage) {
      sent.push(message);
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
    push: (msg: KernelResponse) => handler?.(msg),
  };
}

describe('SessionKernel', () => {
  it('parse resolves on the next snapshot response', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport);

    const promise = kernel.parse('code', 'python');
    expect(sent).toEqual([{ type: 'parse', code: 'code', language: 'python' }]);

    push({
      type: 'snapshot',
      data: { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 0, gates: [] },
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.snapshot.qubit_count).toBe(1);
  });

  it('parse resolves ok:false on a parse-phase error', async () => {
    const { transport, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport);

    const promise = kernel.parse('bad code', 'python');
    push({ type: 'error', message: 'SyntaxError: invalid syntax', phase: 'parse' });

    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toBe('SyntaxError: invalid syntax');
  });

  it('simulate resolves on the next result response', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport);

    const promise = kernel.simulate('code', 512, 'python');
    expect(sent).toEqual([{ type: 'execute', code: 'code', shots: 512, language: 'python' }]);

    push({
      type: 'result',
      data: {
        state_vector: [],
        probabilities: { '0': 1 },
        measurements: {},
        bloch_coords: [],
        execution_time_ms: 1,
        shot_count: 512,
      },
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.shot_count).toBe(512);
  });

  it('simulate resolves ok:false on an execute-phase error', async () => {
    const { transport, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport);

    const promise = kernel.simulate('code', 100, 'python');
    push({ type: 'error', message: 'ZeroDivisionError', phase: 'execute' });

    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toBe('ZeroDivisionError');
  });

  it('simulate also resolves on a python-phase error', async () => {
    const { transport, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport);

    const promise = kernel.simulate('code', 100, 'python');
    push({ type: 'error', message: 'boom', phase: 'python' });

    const outcome = await promise;
    expect(outcome.ok).toBe(false);
  });

  it('unrelated responses (e.g. hardware messages) do not resolve a pending parse', async () => {
    const { transport, push } = makeFakeTransport();
    const kernel = new SessionKernel(transport);

    const promise = kernel.parse('code', 'python');
    push({ type: 'hardware_connected_providers', providers: [] });
    push({
      type: 'snapshot',
      data: { framework: 'qiskit', qubit_count: 3, classical_bit_count: 0, depth: 0, gates: [] },
    });

    const outcome = await promise;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.snapshot.qubit_count).toBe(3);
  });

  it('times out if the kernel never responds', async () => {
    const { transport } = makeFakeTransport();
    const kernel = new SessionKernel(transport, 20);

    const outcome = await kernel.parse('code', 'python');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).toMatch(/timed out/i);
  });
});
