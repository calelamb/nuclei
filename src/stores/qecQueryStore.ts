import { create } from 'zustand';

import type { QecQuerySpec, QecTilePayload } from '../types/qecData';
import type { QueryFrame } from '../types/qecDataProtocol';

export type QecQueryStatus = 'idle' | 'loading' | 'complete' | 'error' | 'cancelling' | 'cancelled';

export interface QecQueryTileState {
  projectRoot: string;
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
  projectRoot: string | null;
  scopeEpoch: number;
  epochCounter: number;
  tiles: Readonly<Record<string, QecQueryTileState>>;
  run(client: QecQueryClient, query: QecQuerySpec): Promise<void>;
  cancel(client: QecQueryClient, key: string): Promise<void>;
  activeRequestIds(): readonly string[];
  setProjectScope(projectRoot: string | null): void;
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
  projectRoot: string,
  scopeEpoch: number,
  update: (current: QecQueryTileState) => QecQueryTileState,
): void {
  useQecQueryStore.setState((state) => {
    const current = state.tiles[key];
    if (!current || current.epoch !== epoch || state.projectRoot !== projectRoot || state.scopeEpoch !== scopeEpoch) return state;
    return { tiles: Object.freeze({ ...state.tiles, [key]: update(current) }) };
  });
}

function applyFrame(key: string, epoch: number, projectRoot: string, scopeEpoch: number, event: QueryFrame): void {
  updateOwned(key, epoch, projectRoot, scopeEpoch, (current) => {
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
  const current = useQecQueryStore.getState();
  if (!current.projectRoot) return;
  const projectRoot = current.projectRoot;
  const scopeEpoch = current.scopeEpoch;
  const previous = current.tiles[key];
  const epoch = current.epochCounter + 1;
  useQecQueryStore.setState((state) => ({
    epochCounter: epoch,
    tiles: Object.freeze({
      ...state.tiles,
      [key]: {
        projectRoot,
        requestId: query.requestId, epoch, status: 'loading', progress: 0,
        message: 'Starting query', frames: Object.freeze([]), error: null,
      },
    }),
  }));
  if (previous?.status === 'loading' || previous?.status === 'cancelling') {
    void client.cancel('query', previous.requestId).catch(() => undefined);
  }
  try {
    await client.query(query, (event) => applyFrame(key, epoch, projectRoot, scopeEpoch, event));
  } catch (error: unknown) {
    updateOwned(key, epoch, projectRoot, scopeEpoch, (owned) => ({
      ...owned,
      status: error instanceof Error && 'code' in error && error.code === 'request_cancelled'
        ? 'cancelled'
        : 'error',
      error: errorMessage(error),
    }));
  }
}

async function cancelQuery(client: QecQueryClient, key: string): Promise<void> {
  const state = useQecQueryStore.getState();
  const current = state.tiles[key];
  if (!current || !['loading', 'cancelling'].includes(current.status)) return;
  if (!state.projectRoot || current.projectRoot !== state.projectRoot) return;
  const projectRoot = state.projectRoot;
  const scopeEpoch = state.scopeEpoch;
  useQecQueryStore.setState((state) => ({
    tiles: Object.freeze({
      ...state.tiles,
      [key]: { ...current, status: 'cancelling', message: 'Cancelling query' },
    }),
  }));
  try {
    const cancelled = await client.cancel('query', current.requestId);
    if (!cancelled) {
      updateOwned(key, current.epoch, projectRoot, scopeEpoch, (owned) => owned.status === 'cancelling'
        ? { ...owned, status: 'loading', message: 'Cancellation declined' }
        : owned);
      return;
    }
    const epoch = useQecQueryStore.getState().epochCounter + 1;
    useQecQueryStore.setState((state) => {
      const owned = state.tiles[key];
      if (!owned || owned.epoch !== current.epoch || owned.status !== 'cancelling') return state;
      return {
        epochCounter: epoch,
        tiles: Object.freeze({ ...state.tiles, [key]: { ...owned, epoch, status: 'cancelled', message: 'Query cancelled' } }),
      };
    });
  } catch (error: unknown) {
    updateOwned(key, current.epoch, projectRoot, scopeEpoch, (owned) => owned.status === 'cancelling'
      ? { ...owned, status: 'error', error: errorMessage(error) }
      : owned);
  }
}

export const useQecQueryStore = create<QecQueryState>()(() => ({
  projectRoot: null,
  scopeEpoch: 0,
  epochCounter: 0,
  tiles: EMPTY_TILES,
  run: runQuery,
  cancel: cancelQuery,
  activeRequestIds: (): readonly string[] => Object.freeze(Object.values(useQecQueryStore.getState().tiles)
    .filter((tile) => ['loading', 'cancelling'].includes(tile.status))
    .map((tile) => tile.requestId)),
  setProjectScope: (projectRoot) => useQecQueryStore.setState((state) => state.projectRoot === projectRoot
    ? state
    : {
      projectRoot,
      scopeEpoch: state.scopeEpoch + 1,
      epochCounter: state.epochCounter + 1,
      tiles: EMPTY_TILES,
    }),
  reset: () => useQecQueryStore.setState((state) => ({
    projectRoot: null,
    scopeEpoch: state.scopeEpoch + 1,
    epochCounter: state.epochCounter + 1,
    tiles: EMPTY_TILES,
  })),
}));
