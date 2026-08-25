import { beforeEach, describe, expect, it } from 'vitest';

import {
  useQecWorkbenchStore,
} from './qecWorkbenchStore';

const DEFAULTS = {
  preset: 'build' as const,
  pinnedPanelIds: [],
  sourceWidth: 280,
  inspectorWidth: 360,
  trayHeight: 260,
  trayCollapsed: false,
  persistenceError: null,
  persistenceIssue: null,
};

describe('qecWorkbenchStore', () => {
  beforeEach(() => {
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
      trayHeight: 180,
    });
  });

  it('keeps split dimensions unchanged for invalid numeric input', () => {
    const initial = useQecWorkbenchStore.getState();
    useQecWorkbenchStore.getState().setSourceWidth(Number.NaN);
    useQecWorkbenchStore.getState().setInspectorWidth(Number.POSITIVE_INFINITY);
    useQecWorkbenchStore.getState().setTrayHeight(Number.NEGATIVE_INFINITY);

    expect(useQecWorkbenchStore.getState()).toMatchObject({
      sourceWidth: initial.sourceWidth,
      inspectorWidth: initial.inspectorWidth,
      trayHeight: initial.trayHeight,
    });
  });

  it('returns a new frozen pin array when unpinning an absent panel', () => {
    const initialPins = useQecWorkbenchStore.getState().pinnedPanelIds;
    useQecWorkbenchStore.getState().unpinPanel('editor');
    const pins = useQecWorkbenchStore.getState().pinnedPanelIds;

    expect(pins).toEqual([]);
    expect(pins).not.toBe(initialPins);
    expect(Object.isFrozen(pins)).toBe(true);
  });

  it('owns tray collapse state with immutable actions', () => {
    const before = useQecWorkbenchStore.getState();

    before.toggleTrayCollapsed();

    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(true);
    expect(useQecWorkbenchStore.getState()).not.toBe(before);
  });

  it('hydrates a copied persisted layout without replacing store actions', () => {
    const pins = ['editor'] as const;
    useQecWorkbenchStore.getState().hydrate({
      preset: 'analyze',
      pinnedPanelIds: pins,
      sourceWidth: 310,
      inspectorWidth: 400,
      trayHeight: 280,
      trayCollapsed: true,
    });

    const state = useQecWorkbenchStore.getState();
    expect(state).toMatchObject({
      preset: 'analyze',
      sourceWidth: 310,
      pinnedPanelIds: ['editor'],
      trayCollapsed: true,
    });
    expect(state.pinnedPanelIds).not.toBe(pins);
    expect(state.setPreset).toBeTypeOf('function');
  });

  it('exposes and clears user-facing persistence failures', () => {
    useQecWorkbenchStore.getState().setPersistenceError('Could not save QEC workspace context.');
    expect(useQecWorkbenchStore.getState().persistenceError).toMatch(/Could not save/);

    useQecWorkbenchStore.getState().setPersistenceError(null);
    expect(useQecWorkbenchStore.getState().persistenceError).toBeNull();
  });

  it('publishes retryable persistence issues without mutating prior status', () => {
    const issue = {
      scopeKey: 'qec-workbench:/project:study',
      token: 1,
      operation: 'write' as const,
      message: 'Could not save.',
      instruction: 'Retry save.',
      retrying: false,
      retry: () => undefined,
    };
    useQecWorkbenchStore.getState().setPersistenceIssue(issue);
    const published = useQecWorkbenchStore.getState().persistenceIssue;

    useQecWorkbenchStore.getState().setPersistenceIssue({ ...issue, retrying: true });

    expect(published).toBe(issue);
    expect(published?.retrying).toBe(false);
    expect(useQecWorkbenchStore.getState()).toMatchObject({
      persistenceError: 'Could not save.',
      persistenceIssue: { retrying: true },
    });
  });
});
