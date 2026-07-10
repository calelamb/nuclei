import { describe, expect, it } from 'vitest';
import type { KernelTransport } from './liveKernel';
import { SocketSubmitPort } from './liveSubmit';

function makeFakeTransport(): {
  transport: KernelTransport;
  sent: Array<Record<string, unknown>>;
  push: (msg: unknown) => void;
} {
  const sent: Array<Record<string, unknown>> = [];
  let handler: ((msg: unknown) => void) | null = null;
  const transport: KernelTransport = {
    send(message: object) {
      sent.push(message as Record<string, unknown>);
    },
    onMessage(h) {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
  return { transport, sent, push: (msg: unknown) => handler?.(msg) };
}

describe('SocketSubmitPort', () => {
  it('submit sends hardware_submit and resolves ok on hardware_job_submitted', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const promise = port.submit({ provider: 'ibm', backend: 'ibm-brisbane', shots: 1024, code: 'x', language: 'python' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'hardware_submit',
      provider: 'ibm',
      backend: 'ibm-brisbane',
      shots: 1024,
      code: 'x',
      language: 'python',
    });

    push({ type: 'hardware_job_submitted', job: { id: 'job_1', provider: 'ibm', backend: 'ibm-brisbane', status: 'queued', queue_position: 0, shots: 1024, submitted_at: 'now' } });

    const result = await promise;
    expect(result).toEqual({ ok: true, jobId: 'job_1' });
  });

  it('submit resolves ok:false on a generic error response', async () => {
    const { transport, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const promise = port.submit({ provider: 'ibm', backend: 'ibm-brisbane', shots: 1024, code: 'x', language: 'python' });
    push({ type: 'error', message: 'No credentials configured for ibm.' });

    const result = await promise;
    expect(result).toEqual({ ok: false, error: 'No credentials configured for ibm.' });
  });

  it('submit times out if the kernel never responds', async () => {
    const { transport } = makeFakeTransport();
    const port = new SocketSubmitPort(transport, 20);

    const result = await port.submit({ provider: 'ibm', backend: 'ibm-brisbane', shots: 1024, code: 'x', language: 'python' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/timed out/i);
  });

  it('two submits are correlated FIFO against hardware_job_submitted', async () => {
    const { transport, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const first = port.submit({ provider: 'ibm', backend: 'a', shots: 100, code: 'a', language: 'python' });
    push({ type: 'hardware_job_submitted', job: { id: 'job_a', provider: 'ibm', backend: 'a', status: 'queued', queue_position: 0, shots: 100, submitted_at: 'now' } });
    const resultA = await first;
    expect(resultA).toEqual({ ok: true, jobId: 'job_a' });

    const second = port.submit({ provider: 'ibm', backend: 'b', shots: 200, code: 'b', language: 'python' });
    push({ type: 'hardware_job_submitted', job: { id: 'job_b', provider: 'ibm', backend: 'b', status: 'queued', queue_position: 0, shots: 200, submitted_at: 'now' } });
    const resultB = await second;
    expect(resultB).toEqual({ ok: true, jobId: 'job_b' });
  });

  it('status sends hardware_status and resolves on a matching hardware_job_update', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const promise = port.status('job_1');
    expect(sent[0]).toEqual({ type: 'hardware_status', job_id: 'job_1' });

    // A response for a different job first — must not resolve this call.
    push({ type: 'hardware_job_update', job: { id: 'job_other', status: 'running', queue_position: 2 } });
    push({ type: 'hardware_job_update', job: { id: 'job_1', status: 'running', queue_position: 5 } });

    const status = await promise;
    expect(status).toEqual({ jobId: 'job_1', status: 'running', queuePosition: 5 });
  });

  it('status resolves unknown on timeout', async () => {
    const { transport } = makeFakeTransport();
    const port = new SocketSubmitPort(transport, 20);

    const status = await port.status('job_1');
    expect(status).toEqual({ jobId: 'job_1', status: 'unknown', queuePosition: null });
  });

  it('results sends hardware_results and converts measurement counts to normalized probabilities', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const promise = port.results('job_1');
    expect(sent[0]).toEqual({ type: 'hardware_results', job_id: 'job_1' });

    push({ type: 'hardware_result', job_id: 'job_1', data: { measurements: { '00': 750, '11': 250 } } });

    const outcome = await promise;
    if ('error' in outcome) throw new Error('expected success');
    expect(outcome.jobId).toBe('job_1');
    expect(outcome.probabilities).toEqual({ '00': 0.75, '11': 0.25 });
  });

  it('results resolves an error outcome when the kernel reports data.error', async () => {
    const { transport, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const promise = port.results('job_1');
    push({ type: 'hardware_result', job_id: 'job_1', data: { error: 'Job failed on the provider.' } });

    const outcome = await promise;
    expect(outcome).toEqual({ error: 'Job failed on the provider.' });
  });

  it('cancel sends hardware_cancel and resolves success on a matching hardware_job_cancelled', async () => {
    const { transport, sent, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const promise = port.cancel('job_1');
    expect(sent[0]).toEqual({ type: 'hardware_cancel', job_id: 'job_1' });

    push({ type: 'hardware_job_cancelled', job_id: 'job_other', success: true });
    push({ type: 'hardware_job_cancelled', job_id: 'job_1', success: true });

    expect(await promise).toBe(true);
  });

  it('ignores unrelated and malformed messages entirely', async () => {
    const { transport, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);

    const promise = port.status('job_1');
    push(null);
    push('not an object');
    push({ type: 'hardware_connected_providers', providers: [] });
    push({ type: 'hardware_job_update', job: { id: 'job_1', status: 'complete', queue_position: null } });

    const status = await promise;
    expect(status.status).toBe('complete');
  });

  it('dispose unsubscribes from the transport without throwing', () => {
    const { transport, push } = makeFakeTransport();
    const port = new SocketSubmitPort(transport);
    port.dispose();

    expect(() => push({ type: 'hardware_job_submitted', job: { id: 'x' } })).not.toThrow();
  });
});
