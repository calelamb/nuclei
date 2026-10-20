import { describe, it, expect, beforeEach } from 'vitest';

// The "node" test environment has no localStorage; same in-memory stand-in as learnGateStore.test.ts.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? (this.store.get(key) as string) : null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import { applyViewQueryParam, deepLinkableViews, parseViewParam } from './viewQueryParam';
import { useNavigationStore } from '../stores/navigationStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useLearnGateStore } from '../stores/learnGateStore';

describe('parseViewParam', () => {
  it('reads the view value', () => {
    expect(parseViewParam('?view=qec')).toBe('qec');
    expect(parseViewParam('?learn&view=search')).toBe('search');
  });
  it('is null when absent or empty', () => {
    expect(parseViewParam('')).toBeNull();
    expect(parseViewParam('?learn')).toBeNull();
    expect(parseViewParam('?view=')).toBeNull();
    expect(parseViewParam('?view=%20')).toBeNull();
  });
});

describe('applyViewQueryParam', () => {
  beforeEach(() => {
    localStorage.clear();
    useLearnGateStore.getState().setLearnEnabled(false);
    useWorkspaceStore.setState({ mode: 'research' });
    useNavigationStore.setState({ activeView: 'files' });
  });

  it('opens a known Research rail view', () => {
    expect(applyViewQueryParam('?view=qec')).toBe('qec');
    expect(useNavigationStore.getState().activeView).toBe('qec');
    expect(useWorkspaceStore.getState().mode).toBe('research');
  });

  it('switches a Learn workspace to Research when the Learn gate is on', () => {
    useLearnGateStore.getState().setLearnEnabled(true);
    useWorkspaceStore.setState({ mode: 'learn' });
    expect(applyViewQueryParam('?view=qec')).toBe('qec');
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useNavigationStore.getState().activeView).toBe('qec');
  });

  it('ignores unknown ids and Learn-only views', () => {
    for (const q of ['?view=nope', '?view=learning', '?view=challenges', '?view=__proto__', '']) {
      expect(applyViewQueryParam(q)).toBeNull();
      expect(useNavigationStore.getState().activeView).toBe('files');
    }
  });

  it('only accepts the Research rail, and developer views only when enabled', () => {
    const views = deepLinkableViews();
    expect(views).toContain('qec');
    expect(views).not.toContain('learning');
    expect(views).not.toContain('search');
    expect(applyViewQueryParam('?view=search')).toBeNull();
  });
});
