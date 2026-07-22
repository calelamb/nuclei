import { create } from 'zustand';

import type { QecSession } from '../types/qecData';

export interface QecSessionCatalogClient {
  listSessions(limit?: number): Promise<readonly QecSession[]>;
}

type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

interface QecSessionCatalogState {
  projectRoot: string | null;
  sessions: readonly QecSession[];
  status: CatalogStatus;
  error: string | null;
  requestVersion: number;
  load(client: QecSessionCatalogClient, projectRoot: string): Promise<void>;
  reset(): void;
}

const EMPTY_SESSIONS: readonly QecSession[] = Object.freeze([]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Canonical QEC sessions could not be loaded.';
}

async function loadCatalog(
  client: QecSessionCatalogClient,
  projectRoot: string,
): Promise<void> {
  const current = useQecSessionCatalogStore.getState();
  const requestVersion = current.requestVersion + 1;
  useQecSessionCatalogStore.setState({
    projectRoot,
    sessions: current.projectRoot === projectRoot ? current.sessions : EMPTY_SESSIONS,
    status: 'loading',
    error: null,
    requestVersion,
  });
  try {
    const sessions = await client.listSessions();
    if (useQecSessionCatalogStore.getState().requestVersion !== requestVersion) return;
    useQecSessionCatalogStore.setState({ sessions: Object.freeze([...sessions]), status: 'ready' });
  } catch (error: unknown) {
    if (useQecSessionCatalogStore.getState().requestVersion !== requestVersion) return;
    useQecSessionCatalogStore.setState({ status: 'error', error: errorMessage(error) });
  }
}

export const useQecSessionCatalogStore = create<QecSessionCatalogState>(() => ({
  projectRoot: null,
  sessions: EMPTY_SESSIONS,
  status: 'idle',
  error: null,
  requestVersion: 0,
  load: loadCatalog,
  reset: () => useQecSessionCatalogStore.setState((state) => ({
    projectRoot: null,
    sessions: EMPTY_SESSIONS,
    status: 'idle',
    error: null,
    requestVersion: state.requestVersion + 1,
  })),
}));
