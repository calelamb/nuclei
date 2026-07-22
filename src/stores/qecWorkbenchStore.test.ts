import { beforeEach, describe, expect, it } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import {
  loadQecWorkbenchState,
  QEC_WORKBENCH_STORAGE_KEY,
  useQecWorkbenchStore,
} from './qecWorkbenchStore';

const DEFAULTS = {
  preset: 'build' as const,
  pinnedPanelIds: [],
  sourceWidth: 280,
  inspectorWidth: 360,
  trayHeight: 260,
};

describe('qecWorkbenchStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useQecWorkbenchStore.setState(DEFAULTS);
  });

  it('returns new pin arrays and does not duplicate a pinned panel', () => {
    const initialPins = useQecWorkbenchStore.getState().pinnedPanelIds;
    useQecWorkbenchStore.getState().pinPanel('editor');
    const pinned = useQecWorkbenchStore.getState().pinnedPanelIds;

    expect(pinned).toEqual(['editor']);
    expect(pinned).not.toBe(initialPins);

    useQecWorkbenchStore.getState().pinPanel('editor');
    expect(useQecWorkbenchStore.getState().pinnedPanelIds).toEqual(['editor']);
  });

  it('bounds persisted split dimensions', () => {
    useQecWorkbenchStore.getState().setSourceWidth(10);
    useQecWorkbenchStore.getState().setInspectorWidth(10_000);
    useQecWorkbenchStore.getState().setTrayHeight(10);

    expect(useQecWorkbenchStore.getState()).toMatchObject({
      sourceWidth: 220,
      inspectorWidth: 560,
      trayHeight: 160,
    });
  });

  it('falls back to build when persisted preset is invalid', () => {
    localStorage.setItem(
      QEC_WORKBENCH_STORAGE_KEY,
      JSON.stringify({ preset: 'unsupported', sourceWidth: 320, pinnedPanelIds: ['editor'] }),
    );

    expect(loadQecWorkbenchState()).toMatchObject({
      preset: 'build',
      sourceWidth: 320,
      pinnedPanelIds: ['editor'],
    });
  });
});
