import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { QEC_DATA_MAX_FRAME_BYTES } from '../types/qecDataProtocol';
import {
  QecDataClient,
  QecDataClientError,
  connectQecDataClient,
  type QecWebSocket,
} from './qecDataClient';

type SocketListener = (event: Event | MessageEvent<string>) => void;

class FakeSocket implements QecWebSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, SocketListener[]>();
  closed = false;
  sendError: Error | null = null;

  addEventListener(type: string, listener: SocketListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(frame: string): void {
    if (this.sendError) throw this.sendError;
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: Event | MessageEvent<string> = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  message(value: unknown): void {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(value) }));
  }
}

function setup(): { client: QecDataClient; socket: FakeSocket } {
  const socket = new FakeSocket();
  let id = 0;
  const client = new QecDataClient(
    { url: 'ws://127.0.0.1:9743', token: 'secret-token' },
    { socketFactory: () => socket, requestIdFactory: () => `request-${++id}` },
  );
  return { client, socket };
}

async function authenticate(client: QecDataClient, socket: FakeSocket): Promise<void> {
  const connecting = client.connect();
  socket.emit('open');
  expect(JSON.parse(socket.sent[0])).toEqual({ type: 'authenticate', token: 'secret-token' });
  socket.message({ type: 'authenticated' });
  await connecting;
}

function session(sessionId: string): Record<string, unknown> {
  const value = JSON.parse(
    readFileSync(resolve('schemas/qec-data/v1/fixtures/minimal-session.json'), 'utf8'),
  ) as Record<string, unknown>;
  return { ...value, session_id: sessionId, provenance_id: `provenance-${sessionId}` };
}

describe('QecDataClient', () => {
  it('loads every strictly correlated session page in stable engine order', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);

    const listing = client.listSessions(2);
    expect(JSON.parse(socket.sent[1])).toEqual({
      type: 'session_list', requestId: 'request-1', cursor: null, limit: 2,
    });
    socket.message({
      type: 'session_list_result', requestId: 'request-1',
      sessions: [session('session-a'), session('session-b')], nextCursor: 'session-b',
    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    expect(JSON.parse(socket.sent[2])).toEqual({
      type: 'session_list', requestId: 'request-2', cursor: 'session-b', limit: 2,
    });
    socket.message({
      type: 'session_list_result', requestId: 'request-2',
      sessions: [session('session-c')], nextCursor: null,
    });

    await expect(listing).resolves.toEqual([
      expect.objectContaining({ session_id: 'session-a' }),
      expect.objectContaining({ session_id: 'session-b' }),
      expect.objectContaining({ session_id: 'session-c' }),
    ]);
  });

  it('rejects invalid session pagination bounds and a non-advancing cursor', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    await expect(client.listSessions(0)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(socket.sent).toHaveLength(1);

    const listing = client.listSessions(1);
    socket.message({
      type: 'session_list_result', requestId: 'request-1',
      sessions: [session('session-a')], nextCursor: 'session-a',
    });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    socket.message({
      type: 'session_list_result', requestId: 'request-2',
      sessions: [session('session-a')], nextCursor: 'session-a',
    });

    await expect(listing).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects a session page whose cursor does not name its final ordered session', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const listing = client.listSessions(10);

    socket.message({
      type: 'session_list_result', requestId: 'request-1',
      sessions: [session('session-b'), session('session-a')], nextCursor: 'session-a',
    });

    await expect(listing).rejects.toMatchObject({ code: 'invalid_response' });
    expect(socket.sent).toHaveLength(2);
  });

  it('matches Python code-point ordering and rejects oversized pages', async () => {
    const unicode = setup();
    await authenticate(unicode.client, unicode.socket);
    const listing = unicode.client.listSessions(2);
    unicode.socket.message({
      type: 'session_list_result', requestId: 'request-1',
      sessions: [session('\uE000'), session('😀')], nextCursor: null,
    });
    await expect(listing).resolves.toHaveLength(2);

    const oversized = setup();
    await authenticate(oversized.client, oversized.socket);
    const invalid = oversized.client.listSessions(1);
    oversized.socket.message({
      type: 'session_list_result', requestId: 'request-1',
      sessions: [session('session-a'), session('session-b')], nextCursor: null,
    });
    await expect(invalid).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects every endpoint except the exact fixed loopback URL before opening a socket', () => {
    const factory = vi.fn(() => new FakeSocket());

    expect(() => new QecDataClient(
      { url: 'ws://localhost:9743', token: 'secret-token' },
      { socketFactory: factory },
    )).toThrow(/127\.0\.0\.1/);
    expect(factory).not.toHaveBeenCalled();
  });

  it('authenticates first and waits for authenticated before sending a request', async () => {
    const { client, socket } = setup();
    const connecting = client.connect();
    socket.emit('open');

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'authenticate', token: 'secret-token' });
    socket.message({ type: 'authenticated' });
    await connecting;

    const probe = client.probe('captures/run.csv');
    expect(JSON.parse(socket.sent[1])).toEqual({
      type: 'import_probe', requestId: 'request-1', source: 'captures/run.csv',
    });
    socket.message({
      type: 'import_probe_result', requestId: 'request-1', sourcePolicy: 'copy',
      sourceByteSize: 512, results: [{
        adapterId: 'sinter-csv', adapterVersion: '1', supported: true,
        sourceKind: 'sinter-csv', confidence: 1, sourceSha256: 'a'.repeat(64), details: {},
      }],
    });

    await expect(probe).resolves.toMatchObject({ sourcePolicy: 'copy', sourceByteSize: 512 });
  });

  it('rejects project escapes before transmitting the source path', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);

    await expect(client.probe('../outside.csv')).rejects.toMatchObject({ code: 'source_not_authorized' });
    expect(socket.sent).toHaveLength(1);
  });

  it('validates unknown inbound frames and enforces one MiB before JSON parsing', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const probe = client.probe('capture.csv');
    const oversized = `{"type":"error","message":"${'x'.repeat(QEC_DATA_MAX_FRAME_BYTES)}"}`;

    socket.emit('message', new MessageEvent('message', { data: oversized }));

    await expect(probe).rejects.toMatchObject({ code: 'frame_too_large' });
    expect(socket.closed).toBe(true);
  });

  it.each([
    ['non-text', 42],
    ['invalid JSON', '{'],
    ['schema-invalid JSON', JSON.stringify({ type: 'mystery' })],
  ])('closes on %s inbound frames', async (_label, data) => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const probe = client.probe('capture.csv');

    socket.emit('message', new MessageEvent('message', { data }));

    await expect(probe).rejects.toMatchObject({ code: 'invalid_response' });
    expect(socket.closed).toBe(true);
  });

  it('rejects every pending operation when the engine disconnects', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const probe = client.probe('capture.csv');
    const validation = client.validate('capture.csv', 'tabular', {
      fields: { sequence: 'shot_id' }, options: { output_kind: 'syndromes' },
    });

    socket.emit('close');

    await expect(probe).rejects.toMatchObject({ code: 'engine_disconnected' });
    await expect(validation).rejects.toMatchObject({ code: 'engine_disconnected' });
  });

  it('handles requestless connection errors without assuming requestId exists', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const probe = client.probe('capture.csv');

    socket.message({ type: 'error', code: 'internal_error', message: 'Engine failed.' });

    await expect(probe).rejects.toEqual(expect.objectContaining({
      code: 'internal_error', message: 'Engine failed.',
    }));
  });

  it('rejects a correlated server error and an unexpected terminal frame', async () => {
    const first = setup();
    await authenticate(first.client, first.socket);
    const rejected = first.client.probe('capture.csv');
    first.socket.message({ type: 'error', requestId: 'request-1', code: 'probe_failed', message: 'Probe failed.' });
    await expect(rejected).rejects.toMatchObject({ code: 'probe_failed' });

    const second = setup();
    await authenticate(second.client, second.socket);
    const unexpected = second.client.probe('capture.csv');
    second.socket.message({
      type: 'import_validation_result', requestId: 'request-1', valid: true, issues: [],
      sourceSha256: 'a'.repeat(64), provenanceId: 'p', sourceByteSize: 1, sourcePolicy: 'copy',
    });
    await expect(unexpected).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects duplicate authentication and outbound send failures', async () => {
    const duplicate = setup();
    await authenticate(duplicate.client, duplicate.socket);
    const pending = duplicate.client.probe('capture.csv');
    duplicate.socket.message({ type: 'authenticated' });
    await expect(pending).rejects.toMatchObject({ code: 'invalid_response' });

    const failed = setup();
    await authenticate(failed.client, failed.socket);
    failed.socket.sendError = new Error('send failed');
    await expect(failed.client.probe('capture.csv')).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rejects duplicate pending request IDs before replacing the original owner', async () => {
    const socket = new FakeSocket();
    const client = new QecDataClient(
      { url: 'ws://127.0.0.1:9743', token: 'secret-token' },
      { socketFactory: () => socket, requestIdFactory: () => 'duplicate' },
    );
    await authenticate(client, socket);
    const first = client.probe('first.csv');

    await expect(client.probe('second.csv')).rejects.toMatchObject({ code: 'duplicate_request' });
    socket.message({
      type: 'import_probe_result', requestId: 'duplicate', sourcePolicy: 'copy',
      sourceByteSize: 1, results: [],
    });
    await expect(first).resolves.toMatchObject({ requestId: 'duplicate' });
  });

  it('rejects cross-operation and out-of-order multi-frame responses', async () => {
    const querySetup = setup();
    await authenticate(querySetup.client, querySetup.socket);
    const query = querySetup.client.query({
      requestId: 'query-order', sessionId: 'session-1', datasetId: 'dataset-1', tile: 'heatmap',
      selection: { primary: null, scope: [], timeWindow: null, source: 'user' },
      resolution: { width: 10, height: 10 }, filters: {},
    }, vi.fn());
    querySetup.socket.message({ type: 'progress', requestId: 'query-order', fraction: 0.1, message: 'early' });
    await expect(query).rejects.toMatchObject({ code: 'invalid_response' });

    const importSetup = setup();
    await authenticate(importSetup.client, importSetup.socket);
    const importing = importSetup.client.startImport({
      source: 'capture.csv', adapterId: 'tabular', mapping: { fields: {}, options: {} },
      sessionId: 'session-1', sessionKind: 'hardware_import',
    });
    importSetup.socket.message({
      type: 'job_complete', requestId: 'request-1', jobId: 'request-1',
      recordsWritten: 1, partitionsWritten: 1, sourcePolicy: 'copy',
    });
    await expect(importing).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects frames outside each operation state after job startup', async () => {
    const importing = setup();
    await authenticate(importing.client, importing.socket);
    const importPromise = importing.client.startImport({
      source: 'capture.csv', adapterId: 'tabular', mapping: { fields: {}, options: {} },
      sessionId: 'session-1', sessionKind: 'hardware_import',
    });
    importing.socket.message({ type: 'job_started', requestId: 'request-1', jobId: 'request-1', jobKind: 'import', sourcePolicy: 'copy' });
    importing.socket.message({ type: 'progress', requestId: 'request-1', fraction: 0.5, message: 'wrong stream' });
    await expect(importPromise).rejects.toMatchObject({ code: 'invalid_response' });

    const querying = setup();
    await authenticate(querying.client, querying.socket);
    const queryPromise = querying.client.query({
      requestId: 'query-state', sessionId: 'session-1', datasetId: 'dataset-1', tile: 'heatmap',
      selection: { primary: null, scope: [], timeWindow: null, source: 'user' },
      resolution: { width: 10, height: 10 }, filters: {},
    }, vi.fn());
    querying.socket.message({ type: 'job_started', requestId: 'query-state', jobId: 'query-state', jobKind: 'query' });
    querying.socket.message({ type: 'job_complete', requestId: 'query-state', jobId: 'query-state', recordsWritten: 1, partitionsWritten: 1, sourcePolicy: 'copy' });
    await expect(queryPromise).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('enforces backend session ID rules before transmitting an import', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const sentBefore = socket.sent.length;
    expect(() => client.startImport({
      source: 'capture.csv', adapterId: 'tabular', mapping: { fields: {}, options: {} },
      sessionId: '../bad', sessionKind: 'hardware_import',
    })).toThrow();
    expect(socket.sent).toHaveLength(sentBefore);

    const unicodeSessionId = '🧪'.repeat(256);
    const accepted = client.startImport({
      source: 'capture.csv', adapterId: 'tabular', mapping: { fields: {}, options: {} },
      sessionId: unicodeSessionId, sessionKind: 'hardware_import',
    });
    const request = JSON.parse(socket.sent.at(-1) ?? '') as { requestId: string; sessionId: string };
    expect(request.sessionId).toBe(unicodeSessionId);
    socket.message({ type: 'error', requestId: request.requestId, code: 'test_complete', message: 'Test complete.' });
    await expect(accepted).rejects.toMatchObject({ code: 'test_complete' });
    expect(() => client.startImport({
      source: 'capture.csv', adapterId: 'tabular', mapping: { fields: {}, options: {} },
      sessionId: '🧪'.repeat(257), sessionKind: 'hardware_import',
    })).toThrow();
  });

  it('rejects outbound frames larger than one MiB before socket transmission', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const sentBefore = socket.sent.length;

    await expect(client.startImport({
      source: 'capture.csv', adapterId: 'tabular',
      mapping: { fields: {}, options: { oversized: 'x'.repeat(QEC_DATA_MAX_FRAME_BYTES) } },
      sessionId: 'session-1', sessionKind: 'hardware_import',
    })).rejects.toMatchObject({ code: 'frame_too_large' });
    expect(socket.sent).toHaveLength(sentBefore);
  });

  it('rejects socket loss while connecting and invalid preview bounds', async () => {
    const { client, socket } = setup();
    const connecting = client.connect();
    socket.emit('error');
    await expect(connecting).rejects.toMatchObject({ code: 'engine_disconnected' });

    const connected = setup();
    await authenticate(connected.client, connected.socket);
    await expect(connected.client.preview('capture.csv', 'tabular', { fields: {}, options: {} }, 1001))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('streams progressive query frames and uses query-specific cancellation', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const events: string[] = [];
    const query = client.query({
      requestId: 'query-1', sessionId: 'session-1', datasetId: 'dataset-1', tile: 'heatmap',
      selection: { primary: null, scope: [], timeWindow: null, source: 'user' },
      resolution: { width: 200, height: 100 }, filters: {},
    }, (event) => events.push(event.type));
    socket.message({ type: 'job_started', requestId: 'query-1', jobId: 'query-1', jobKind: 'query' });
    socket.message({ type: 'progress', requestId: 'query-1', fraction: 0.5, message: 'Scanning' });
    socket.message({
      type: 'tile', requestId: 'query-1', complete: true,
      tile: { kind: 'heatmap', datasetId: 'dataset-1', sequence: 0, content: {}, byteLength: 84 },
    });

    await expect(query).resolves.toMatchObject({ kind: 'heatmap', sequence: 0 });
    expect(events).toEqual(['progress', 'tile']);

    const cancelling = client.cancel('query', 'query-2');
    expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({
      type: 'query_cancel', queryRequestId: 'query-2',
    });
    const cancelRequest = JSON.parse(socket.sent.at(-1) ?? '') as { requestId: string };
    socket.message({
      type: 'query_cancelled', requestId: cancelRequest.requestId,
      queryRequestId: 'query-2', success: true,
    });
    await expect(cancelling).resolves.toBe(true);
  });

  it.each([
    ['dataset identity', { kind: 'heatmap', datasetId: 'dataset-other' }],
    ['tile kind', { kind: 'histogram', datasetId: 'dataset-1' }],
  ] as const)('rejects a query tile with mismatched %s', async (_label, mismatch) => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const query = client.query({
      requestId: 'query-semantic', sessionId: 'session-1', datasetId: 'dataset-1', tile: 'heatmap',
      selection: { primary: null, scope: [], timeWindow: null, source: 'user' },
      resolution: { width: 20, height: 10 }, filters: {},
    }, vi.fn());
    socket.message({ type: 'job_started', requestId: 'query-semantic', jobId: 'query-semantic', jobKind: 'query' });
    socket.message({
      type: 'tile', requestId: 'query-semantic', complete: true,
      tile: { ...mismatch, sequence: 0, content: {}, byteLength: 84 },
    });

    await expect(query).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('publishes post-auth disconnects through an immutable subscription', async () => {
    const { client, socket } = setup();
    const activeListener = vi.fn();
    const removedListener = vi.fn();
    const unsubscribe = client.subscribeDisconnect(removedListener);
    client.subscribeDisconnect(activeListener);
    unsubscribe();
    await authenticate(client, socket);

    socket.emit('close');
    socket.emit('close');

    expect(activeListener).toHaveBeenCalledOnce();
    expect(activeListener).toHaveBeenCalledWith(expect.objectContaining({
      code: 'engine_disconnected', message: 'QEC Data Engine disconnected.',
    }));
    expect(removedListener).not.toHaveBeenCalled();
  });

  it('streams import lifecycle frames and uses import-specific cancellation', async () => {
    const { client, socket } = setup();
    await authenticate(client, socket);
    const events: string[] = [];
    const importing = client.startImport({
      source: 'capture.csv', adapterId: 'sinter-csv', mapping: { fields: {}, options: {} },
      sessionId: 'session-1', sessionKind: 'hardware_import',
    }, (event) => events.push(event.type));
    socket.message({ type: 'job_started', requestId: 'request-1', jobId: 'request-1', jobKind: 'import', sourcePolicy: 'copy' });
    socket.message({ type: 'job_complete', requestId: 'request-1', jobId: 'request-1', recordsWritten: 3, partitionsWritten: 1, sourcePolicy: 'copy' });
    await expect(importing).resolves.toMatchObject({ recordsWritten: 3 });
    expect(events).toEqual(['job_started', 'job_complete']);

    const cancelling = client.cancel('import', 'import-2');
    const request = JSON.parse(socket.sent.at(-1) ?? '') as { requestId: string };
    expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ type: 'job_cancel', jobId: 'import-2' });
    socket.message({ type: 'job_cancelled', requestId: request.requestId, jobId: 'import-2', success: false });
    await expect(cancelling).resolves.toBe(false);
  });

  it('exposes stable client errors without reflecting the authentication token', () => {
    const error = new QecDataClientError('engine_disconnected', 'Engine disconnected.');
    expect(error.code).toBe('engine_disconnected');
    expect(error.message).not.toContain('secret-token');
  });

  it('starts through the Tauri endpoint launcher without retaining endpoint data in a store', async () => {
    const socket = new FakeSocket();
    const launcher = vi.fn(async () => ({ url: 'ws://127.0.0.1:9743', token: 'ephemeral' }));
    const connecting = connectQecDataClient('/project', {
      launch: launcher,
      clientDependencies: { socketFactory: () => socket },
    });
    await Promise.resolve();
    socket.emit('open');
    socket.message({ type: 'authenticated' });

    await expect(connecting).resolves.toBeInstanceOf(QecDataClient);
    expect(launcher).toHaveBeenCalledWith('/project');
  });
});
