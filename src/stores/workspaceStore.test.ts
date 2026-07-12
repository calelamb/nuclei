import { describe, it, expect, beforeEach } from 'vitest';

// The vitest "node" environment (see vitest.config.ts) has no browser
// localStorage global. workspaceStore reads/writes it directly (guarded by
// try/catch for restricted environments), so tests that exercise
// persistence need a minimal in-memory stand-in — same pattern as
// settingsStore.test.ts.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import { useWorkspaceStore, __notifyProjectRootChanged } from './workspaceStore';
import { useUIModeStore } from './uiModeStore';

const GLOBAL_KEY = 'nuclei:workspace_mode';
const PROJECT_KEY = 'nuclei:workspace_mode_by_project';

function resetWorkspace() {
  localStorage.removeItem(GLOBAL_KEY);
  localStorage.removeItem(PROJECT_KEY);
  // No project open, global default now cleared -> adopts 'learn'.
  __notifyProjectRootChanged(null);
}

describe('workspaceStore', () => {
  beforeEach(() => {
    resetWorkspace();
    useUIModeStore.setState({ mode: 'intermediate' });
  });

  it('defaults to learn', () => {
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });

  it('setMode persists the global default when no project is open', () => {
    useWorkspaceStore.getState().setMode('research');
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(localStorage.getItem(GLOBAL_KEY)).toBe('research');

    useWorkspaceStore.getState().setMode('learn');
    expect(localStorage.getItem(GLOBAL_KEY)).toBe('learn');
  });

  it('per-project round trip: open A -> research, open B -> learn default, reopen A -> research', () => {
    // Open project A: no remembered mode yet, adopts the global default.
    __notifyProjectRootChanged('/projects/A');
    expect(useWorkspaceStore.getState().mode).toBe('learn');

    // Flip A to Research. A project is open, so this updates A's own
    // entry — not the global default a brand-new project would start
    // from.
    useWorkspaceStore.getState().setMode('research');
    expect(useWorkspaceStore.getState().mode).toBe('research');

    // Open project B: no remembered mode for B, and the global default
    // was never touched (a project was open when we set research above),
    // so B starts in Learn.
    __notifyProjectRootChanged('/projects/B');
    expect(useWorkspaceStore.getState().mode).toBe('learn');

    // Reopening A restores its remembered Research mode.
    __notifyProjectRootChanged('/projects/A');
    expect(useWorkspaceStore.getState().mode).toBe('research');
  });

  it('closing a project (root -> null) falls back to the global default', () => {
    __notifyProjectRootChanged('/projects/A');
    useWorkspaceStore.getState().setMode('research');
    expect(useWorkspaceStore.getState().mode).toBe('research');

    __notifyProjectRootChanged(null);
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });

  it('ignores uiModeStore in both directions', () => {
    useUIModeStore.getState().setMode('beginner');
    useWorkspaceStore.getState().setMode('research');
    expect(useUIModeStore.getState().mode).toBe('beginner');

    useWorkspaceStore.getState().setMode('learn');
    useUIModeStore.getState().setMode('advanced');
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });
});
