import { describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from '../platform/bridge';
import {
  getQecWorkbenchPersistenceWriteQueueSizeForTests,
  getQecWorkbenchStorageKey,
  loadQecWorkbenchState,
  saveQecWorkbenchState,
} from './qecWorkbenchPersistence';

const VALID_STATE = {
  schema: 1 as const,
  preset: 'analyze' as const,
  pinnedPanelIds: ['timeline'] as const,
  sourceWidth: 320,
  inspectorWidth: 420,
  trayHeight: 300,
  trayCollapsed: true,
  selection: {
    primary: { kind: 'detector' as const, id: 'D42', sessionId: 'session-a' },
    scope: [{ kind: 'tick' as const, id: '12', sessionId: 'session-a' }],
    timeWindow: { start: 4, end: 12, domain: 'tick' as const },
    source: 'panel' as const,
  },
};

function storageBridge(values = new Map<string, unknown>()): PlatformBridge {
  return {
    startKernel: vi.fn(), stopKernel: vi.fn(), openFile: vi.fn(), readFile: vi.fn(),
    saveFile: vi.fn(), saveFileAs: vi.fn(), renameFile: vi.fn(), setWindowTitle: vi.fn(),
    getPlatform: () => 'desktop', openDirectory: vi.fn(), listDirectory: vi.fn(),
    createFile: vi.fn(), createDirectory: vi.fn(), deleteFile: vi.fn(),
    getStoredValue: vi.fn(async <T,>(key: string) => (values.get(key) as T | undefined) ?? null),
    setStoredValue: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
  };
}

describe('QEC workbench persistence', () => {
  it('drops an invalid selection primary but preserves valid sibling sections', () => {
    const loaded = loadQecWorkbenchState(JSON.stringify({
      ...VALID_STATE,
      selection: {
        ...VALID_STATE.selection,
        primary: { kind: 'bogus', id: 'x' },
        scope: [VALID_STATE.selection.scope[0], { kind: 'bogus', id: 'bad' }],
        timeWindow: { start: 8, end: 2, domain: 'tick' },
      },
    }));

    expect(loaded.preset).toBe('analyze');
    expect(loaded.selection.primary).toBeNull();
    expect(loaded.selection.scope).toEqual([VALID_STATE.selection.scope[0]]);
    expect(loaded.selection.timeWindow).toBeNull();
    expect(loaded.selection.source).toBe('panel');
  });

  it('normalizes panel ids, split ranges, and invalid section values independently', () => {
    const loaded = loadQecWorkbenchState({
      ...VALID_STATE,
      preset: 'unsupported',
      pinnedPanelIds: ['timeline', 'missing', 'timeline', 'jobs'],
      sourceWidth: 10,
      inspectorWidth: Number.POSITIVE_INFINITY,
      trayHeight: 10_000,
      trayCollapsed: 'yes',
    });

    expect(loaded).toMatchObject({
      schema: 1,
      preset: 'build',
      pinnedPanelIds: ['timeline', 'jobs'],
      sourceWidth: 220,
      inspectorWidth: 360,
      trayHeight: 520,
      trayCollapsed: false,
    });
  });

  it('never throws for corrupt JSON or unsupported schemas', () => {
    expect(loadQecWorkbenchState('{not-json')).toMatchObject({ schema: 1, preset: 'build' });
    expect(loadQecWorkbenchState({ ...VALID_STATE, schema: 2 })).toMatchObject({
      schema: 1,
      preset: 'build',
      selection: { primary: null },
    });
  });

  it('persists immutable snapshots under isolated project and Study keys', async () => {
    const values = new Map<string, unknown>();
    const bridge = storageBridge(values);

    await saveQecWorkbenchState(bridge, '/project-a', 'study-1', VALID_STATE);
    await saveQecWorkbenchState(bridge, '/project-b', 'study-1', {
      ...VALID_STATE,
      preset: 'observe',
    });

    expect(getQecWorkbenchStorageKey('/project-a', 'study-1')).toBe(
      'qec-workbench:/project-a:study-1',
    );
    expect(values.get('qec-workbench:/project-a:study-1')).toMatchObject({ preset: 'analyze' });
    expect(values.get('qec-workbench:/project-b:study-1')).toMatchObject({ preset: 'observe' });
    expect(values.get('qec-workbench:/project-a:study-1')).not.toBe(VALID_STATE);
    expect(
      (values.get('qec-workbench:/project-a:study-1') as typeof VALID_STATE).selection,
    ).not.toBe(VALID_STATE.selection);
  });

  it('propagates platform write failures for the shell to report', async () => {
    const bridge = storageBridge();
    vi.mocked(bridge.setStoredValue).mockRejectedValueOnce(new Error('store unavailable'));

    await expect(
      saveQecWorkbenchState(bridge, '/project', 'study', VALID_STATE),
    ).rejects.toThrow('store unavailable');
  });

  it('releases per-key write coordinator entries after success and failure', async () => {
    const bridge = storageBridge();
    await saveQecWorkbenchState(bridge, '/project', 'success', VALID_STATE);
    await Promise.resolve();
    expect(getQecWorkbenchPersistenceWriteQueueSizeForTests()).toBe(0);

    vi.mocked(bridge.setStoredValue).mockRejectedValueOnce(new Error('store unavailable'));
    await expect(
      saveQecWorkbenchState(bridge, '/project', 'failure', VALID_STATE),
    ).rejects.toThrow('store unavailable');
    await Promise.resolve();
    expect(getQecWorkbenchPersistenceWriteQueueSizeForTests()).toBe(0);
  });
});
