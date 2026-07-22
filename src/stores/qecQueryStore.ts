import { create } from 'zustand';

import type { QecQuerySpec, QecTilePayload } from '../types/qecData';
import type { QueryFrame } from '../types/qecDataProtocol';

export type QecQueryStatus = 'idle' | 'loading' | 'complete' | 'error' | 'cancelling' | 'cancelled';

export interface QecQueryTileState {
  requestId: string;
  epoch: number;
  status: QecQueryStatus;
  progress: number;
  message: string;
  frames: readonly QecTilePayload[];
  error: string | null;
}

export interface QecQueryClient {
  query(query: QecQuerySpec, onEvent: (event: QueryFrame) => void): Promise<QecTilePayload>;
  cancel(kind: 'query', requestId: string): Promise<boolean>;
}

interface QecQueryState {
  epochCounter: number;
  tiles: Readonly<Record<string, QecQueryTileState>>;
  run(client: QecQueryClient, query: QecQuerySpec): Promise<void>;
  cancel(client: QecQueryClient, key: string): Promise<void>;
  reset(): void;
}

const EMPTY_TILES: Readonly<Record<string, QecQueryTileState>> = Object.freeze({});

export function qecQueryTileKey(query: Pick<QecQuerySpec, 'sessionId' | 'datasetId' | 'tile'>): string {
  return `${query.sessionId}:${query.datasetId}:${query.tile}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'QEC query failed.';
}

function withFrame(frames: readonly QecTilePayload[], frame: QecTilePayload): readonly QecTilePayload[] {
  return Object.freeze(
    [...frames.filter((existing) => existing.sequence !== frame.sequence), frame]
      .sort((left, right) => left.sequence - right.sequence),
  );
}

function updateOwned(
  key: string,
  epoch: number,
  update: (current: QecQueryTileState) => QecQueryTileState,
): void {
  useQecQueryStore.setState((state) => {
    const current = state.tiles[key];
    if (!current || current.epoch !== epoch) return state;
    return { tiles: Object.freeze({ ...state.tiles, [key]: update(current) }) };
  });
}

function applyFrame(key: string, epoch: number, event: QueryFrame): void {
  updateOwned(key, epoch, (current) => {
    if (event.type === 'progress') {
      return { ...current, progress: event.fraction, message: event.message };
    }
    return {
      ...current,
      status: event.complete ? 'complete' : 'loading',
      progress: event.complete ? 1 : current.progress,
      frames: withFrame(current.frames, event.tile),
    };
  });
}

async function runQuery(client: QecQueryClient, query: QecQuerySpec): Promise<void> {
  const key = qecQueryTileKey(query);
  const previous = useQecQueryStore.getState().tiles[key];
  const epoch = useQecQueryStore.getState().epochCounter + 1;
  useQecQueryStore.setState((state) => ({
    epochCounter: epoch,
    tiles: Object.freeze({
      ...state.tiles,
      [key]: {
        requestId: query.requestId, epoch, status: 'loading', progress: 0,
        message: 'Starting query', frames: Object.freeze([]), error: null,
      },
    }),
  }));
  if (previous?.status === 'loading' || previous?.status === 'cancelling') {
    void client.cancel('query', previous.requestId).catch(() => undefined);
  }
  try {
    await client.query(query, (event) => applyFrame(key, epoch, event));
  } catch (error: unknown) {
    updateOwned(key, epoch, (current) => ({
      ...current,
      status: error instanceof Error && 'code' in error && error.code === 'request_cancelled'
        ? 'cancelled'
        : 'error',
      error: errorMessage(error),
    }));
  }
}

async function cancelQuery(client: QecQueryClient, key: string): Promise<void> {
  const current = useQecQueryStore.getState().tiles[key];
  if (!current || !['loading', 'cancelling'].includes(current.status)) return;
  const epoch = useQecQueryStore.getState().epochCounter + 1;
  useQecQueryStore.setState((state) => ({
    epochCounter: epoch,
    tiles: Object.freeze({
      ...state.tiles,
      [key]: { ...current, epoch, status: 'cancelling', message: 'Cancelling query' },
    }),
  }));
  try {
    await client.cancel('query', current.requestId);
    updateOwned(key, epoch, (owned) => ({ ...owned, status: 'cancelled', message: 'Query cancelled' }));
  } catch (error: unknown) {
    updateOwned(key, epoch, (owned) => ({ ...owned, status: 'error', error: errorMessage(error) }));
  }
}

export const useQecQueryStore = create<QecQueryState>(() => ({
  epochCounter: 0,
  tiles: EMPTY_TILES,
  run: runQuery,
  cancel: cancelQuery,
  reset: () => useQecQueryStore.setState({ epochCounter: 0, tiles: EMPTY_TILES }),
}));
