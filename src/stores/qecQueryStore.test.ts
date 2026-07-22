import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QecQuerySpec, QecQueryResult, QecTilePayload } from '../types/qecData';
import { useQecQueryStore, qecQueryTileKey, type QecQueryClient } from './qecQueryStore';

const BASE_QUERY: QecQuerySpec = {
  requestId: 'query-old', sessionId: 'session-1', datasetId: 'dataset-1', tile: 'heatmap',
  selection: { primary: null, scope: [], timeWindow: null, source: 'user' },
  resolution: { width: 100, height: 100 }, filters: {},
};

interface DeferredQuery {
  resolve(tile: QecTilePayload): void;
  reject(error: unknown): void;
  emit(event: QecQueryResult): void;
}

function deferredClient(): { client: QecQueryClient; calls: DeferredQuery[] } {
  const calls: DeferredQuery[] = [];
  const client: QecQueryClient = {
    query: vi.fn((_query, onEvent) => new Promise<QecTilePayload>((resolve, reject) => {
      calls.push({ resolve, reject, emit: onEvent });
    })),
    cancel: vi.fn(async () => true),
  };
  return { client, calls };
}

function tile(requestId: string, sequence: number, value: string, complete = true): QecQueryResult {
  return {
    type: 'tile', requestId, complete,
    tile: { kind: 'heatmap', datasetId: 'dataset-1', sequence, content: { value }, byteLength: 96 },
  };
}

beforeEach(() => {
  useQecQueryStore.getState().reset();
  useQecQueryStore.getState().setProjectScope('/project');
});

describe('useQecQueryStore', () => {
  it('clears old-project queries and rejects their late frames by scope epoch', async () => {
    const { client, calls } = deferredClient();
    const pending = useQecQueryStore.getState().run(client, BASE_QUERY);
    expect(useQecQueryStore.getState().activeRequestIds()).toEqual(['query-old']);
    const oldScopeEpoch = useQecQueryStore.getState().scopeEpoch;

    useQecQueryStore.getState().setProjectScope('/replacement');
    calls[0].emit(tile('query-old', 0, 'stale'));
    calls[0].resolve((tile('query-old', 0, 'stale') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await pending;

    expect(useQecQueryStore.getState()).toMatchObject({ projectRoot: '/replacement', tiles: {} });
    expect(useQecQueryStore.getState().scopeEpoch).toBeGreaterThan(oldScopeEpoch);
  });

  it('prevents stale progressive frames from overwriting a newer tile request', async () => {
    const { client, calls } = deferredClient();
    const oldRequest = useQecQueryStore.getState().run(client, BASE_QUERY);
    const newSpec = { ...BASE_QUERY, requestId: 'query-new' };
    const newRequest = useQecQueryStore.getState().run(client, newSpec);

    calls[1].emit(tile('query-new', 0, 'new'));
    calls[1].resolve((tile('query-new', 0, 'new') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await newRequest;
    calls[0].emit(tile('query-old', 0, 'stale'));
    calls[0].resolve((tile('query-old', 0, 'stale') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await oldRequest;

    const state = useQecQueryStore.getState().tiles[qecQueryTileKey(newSpec)];
    expect(state.requestId).toBe('query-new');
    expect(state.frames[0].content).toEqual({ value: 'new' });
    expect(client.cancel).toHaveBeenCalledWith('query', 'query-old');
  });

  it('invalidates the epoch before cancellation so late tiles are ignored', async () => {
    const { client, calls } = deferredClient();
    const pending = useQecQueryStore.getState().run(client, BASE_QUERY);
    const key = qecQueryTileKey(BASE_QUERY);

    await useQecQueryStore.getState().cancel(client, key);
    calls[0].emit(tile('query-old', 0, 'late'));
    calls[0].resolve((tile('query-old', 0, 'late') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await pending;

    expect(useQecQueryStore.getState().tiles[key]).toMatchObject({
      status: 'cancelled', frames: [],
    });
  });

  it('keeps progressive sequences immutable and ordered', async () => {
    const { client, calls } = deferredClient();
    const pending = useQecQueryStore.getState().run(client, BASE_QUERY);
    calls[0].emit(tile('query-old', 2, 'second', false));
    const firstFrames = useQecQueryStore.getState().tiles[qecQueryTileKey(BASE_QUERY)].frames;
    calls[0].emit(tile('query-old', 1, 'first'));
    calls[0].resolve((tile('query-old', 1, 'first') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await pending;

    const frames = useQecQueryStore.getState().tiles[qecQueryTileKey(BASE_QUERY)].frames;
    expect(frames.map((frame) => frame.sequence)).toEqual([1, 2]);
    expect(frames).not.toBe(firstFrames);
  });

  it('records progress and client failures only for the owning epoch', async () => {
    const { client, calls } = deferredClient();
    const pending = useQecQueryStore.getState().run(client, BASE_QUERY);
    calls[0].emit({ type: 'progress', requestId: 'query-old', fraction: 0.4, message: 'Scanning' });
    expect(useQecQueryStore.getState().tiles[qecQueryTileKey(BASE_QUERY)]).toMatchObject({
      progress: 0.4, message: 'Scanning', status: 'loading',
    });
    calls[0].reject(new Error('query exploded'));
    await pending;
    expect(useQecQueryStore.getState().tiles[qecQueryTileKey(BASE_QUERY)]).toMatchObject({
      status: 'error', error: 'query exploded',
    });
  });

  it('turns cancellation failures into an owned error and ignores missing keys', async () => {
    const { client, calls } = deferredClient();
    const pending = useQecQueryStore.getState().run(client, BASE_QUERY);
    vi.mocked(client.cancel).mockRejectedValueOnce(new Error('cancel failed'));

    await useQecQueryStore.getState().cancel(client, qecQueryTileKey(BASE_QUERY));
    expect(useQecQueryStore.getState().tiles[qecQueryTileKey(BASE_QUERY)]).toMatchObject({
      status: 'error', error: 'cancel failed',
    });
    await useQecQueryStore.getState().cancel(client, 'missing');
    calls[0].resolve((tile('query-old', 0, 'ignored') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await pending;
  });

  it('keeps a query running when cancellation is declined', async () => {
    const { client, calls } = deferredClient();
    vi.mocked(client.cancel).mockResolvedValueOnce(false);
    const pending = useQecQueryStore.getState().run(client, BASE_QUERY);
    const key = qecQueryTileKey(BASE_QUERY);

    await useQecQueryStore.getState().cancel(client, key);
    expect(useQecQueryStore.getState().tiles[key]).toMatchObject({ status: 'loading' });
    calls[0].resolve((tile('query-old', 0, 'done') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await pending;
  });

  it('keeps epochs monotonic across reset so pre-reset callbacks cannot win an ABA race', async () => {
    const { client, calls } = deferredClient();
    const old = useQecQueryStore.getState().run(client, BASE_QUERY);
    const oldEpoch = useQecQueryStore.getState().epochCounter;
    useQecQueryStore.getState().reset();
    useQecQueryStore.getState().setProjectScope('/project');
    const fresh = useQecQueryStore.getState().run(client, { ...BASE_QUERY, requestId: 'query-fresh' });

    expect(useQecQueryStore.getState().epochCounter).toBeGreaterThan(oldEpoch);
    calls[0].emit(tile('query-old', 0, 'stale'));
    calls[0].resolve((tile('query-old', 0, 'stale') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    calls[1].emit(tile('query-fresh', 0, 'fresh'));
    calls[1].resolve((tile('query-fresh', 0, 'fresh') as Extract<QecQueryResult, { type: 'tile' }>).tile);
    await Promise.all([old, fresh]);
    expect(useQecQueryStore.getState().tiles[qecQueryTileKey(BASE_QUERY)].frames[0].content).toEqual({ value: 'fresh' });
  });
});
