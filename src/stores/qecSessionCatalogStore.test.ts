import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QecSession } from '../types/qecData';
import { useQecSessionCatalogStore } from './qecSessionCatalogStore';

function session(sessionId: string): QecSession {
  return {
    ...JSON.parse(readFileSync(
      resolve('schemas/qec-data/v1/fixtures/minimal-session.json'), 'utf8',
    )) as QecSession,
    session_id: sessionId,
    provenance_id: `provenance-${sessionId}`,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => useQecSessionCatalogStore.getState().reset());

describe('qecSessionCatalogStore', () => {
  it('invalidates catalog ownership synchronously when project scope changes', async () => {
    const pending = deferred<readonly QecSession[]>();
    useQecSessionCatalogStore.getState().setProjectScope('/old-project');
    const oldLoad = useQecSessionCatalogStore.getState().load(
      { listSessions: vi.fn(() => pending.promise) }, '/old-project',
    );

    useQecSessionCatalogStore.getState().setProjectScope('/new-project');
    pending.resolve([session('old-capture')]);
    await oldLoad;

    expect(useQecSessionCatalogStore.getState()).toMatchObject({
      projectRoot: '/new-project', sessions: [], status: 'idle', error: null,
    });
  });

  it('loads an immutable engine-backed catalog for one project', async () => {
    const listSessions = vi.fn(async () => [session('capture-a')]);
    useQecSessionCatalogStore.getState().setProjectScope('/project');

    await useQecSessionCatalogStore.getState().load({ listSessions }, '/project');

    expect(listSessions).toHaveBeenCalledOnce();
    expect(useQecSessionCatalogStore.getState()).toMatchObject({
      projectRoot: '/project', status: 'ready', error: null,
      sessions: [expect.objectContaining({ session_id: 'capture-a' })],
    });
    expect(Object.isFrozen(useQecSessionCatalogStore.getState().sessions)).toBe(true);
  });

  it('ignores a stale load after the project changes', async () => {
    const first = deferred<readonly QecSession[]>();
    useQecSessionCatalogStore.getState().setProjectScope('/old-project');
    const oldLoad = useQecSessionCatalogStore.getState().load(
      { listSessions: vi.fn(() => first.promise) }, '/old-project',
    );
    useQecSessionCatalogStore.getState().setProjectScope('/new-project');
    await useQecSessionCatalogStore.getState().load(
      { listSessions: vi.fn(async () => [session('new-capture')]) }, '/new-project',
    );

    first.resolve([session('old-capture')]);
    await oldLoad;

    expect(useQecSessionCatalogStore.getState()).toMatchObject({
      projectRoot: '/new-project', sessions: [expect.objectContaining({ session_id: 'new-capture' })],
    });
  });

  it('surfaces engine errors without retaining another project catalog', async () => {
    useQecSessionCatalogStore.getState().setProjectScope('/project');
    await useQecSessionCatalogStore.getState().load(
      { listSessions: vi.fn(async () => { throw new Error('engine unavailable'); }) }, '/project',
    );

    expect(useQecSessionCatalogStore.getState()).toMatchObject({
      projectRoot: '/project', status: 'error', sessions: [], error: 'engine unavailable',
    });
  });
});
