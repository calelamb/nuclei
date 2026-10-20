// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '../test/learnGateOn';
import { renderHook, cleanup, act, waitFor } from '@testing-library/react';
import { useShellLayout } from './useShellLayout';
import { useNavigationStore } from '../stores/navigationStore';
import { useDiracPanelStore } from '../stores/diracPanelStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useLearnStore } from '../stores/learnStore';
import { focusAfterViewSelect } from '../components/layout/focusViz';

vi.mock('../components/layout/focusViz', () => ({ focusAfterViewSelect: vi.fn(() => () => {}) }));

const VIEWS = ['files', 'experiments', 'settings'];

function fakePlatform(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    getStoredValue: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
    setStoredValue: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
  };
}

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
}

beforeEach(() => {
  setWidth(1440);
  useNavigationStore.setState({ activeView: 'files', autoCollapsedView: null, lastNarrow: null });
  useDiracPanelStore.setState({ isOpen: true, width: 320, autoCollapsed: false, lastNarrow: null });
  useBottomPanelStore.setState({ collapsed: false, activeTab: 'terminal' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useShellLayout persistence', () => {
  it('restores the rail view, Dirac state and bottom panel after a reload (shell-09)', async () => {
    const platform = fakePlatform({
      'layout_shell:research': { activeView: 'experiments', diracOpen: false, diracWidth: 360, bottomCollapsed: true, bottomTab: 'terminal' },
    });
    renderHook(() => useShellLayout({ platform: platform as never, mode: 'research', validViews: VIEWS, canCollapseSidebar: true }));
    await waitFor(() => expect(useNavigationStore.getState().activeView).toBe('experiments'));
    expect(useDiracPanelStore.getState().isOpen).toBe(false);
    expect(useDiracPanelStore.getState().width).toBe(360);
    expect(useBottomPanelStore.getState().collapsed).toBe(true);
  });

  it('writes changes back, debounced, under a per-mode key', async () => {
    const platform = fakePlatform();
    renderHook(() => useShellLayout({ platform: platform as never, mode: 'learn', validViews: VIEWS, canCollapseSidebar: true }));
    await waitFor(() => expect(platform.getStoredValue).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    vi.useFakeTimers();
    act(() => { useDiracPanelStore.getState().close(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(platform.setStoredValue).toHaveBeenCalledWith('layout_shell:learn', expect.objectContaining({ diracOpen: false }));
  });

  it('persists the user\'s intent, not a transient auto-collapse', async () => {
    const platform = fakePlatform();
    setWidth(1100);
    renderHook(() => useShellLayout({ platform: platform as never, mode: 'research', validViews: VIEWS, canCollapseSidebar: true }));
    await waitFor(() => expect(useDiracPanelStore.getState().autoCollapsed).toBe(true));
    vi.useFakeTimers();
    act(() => { useBottomPanelStore.getState().setCollapsed(true); });
    await act(async () => { vi.advanceTimersByTime(600); });
    const saved = platform.store.get('layout_shell:research') as { diracOpen: boolean; activeView: string };
    expect(saved.diracOpen).toBe(true);
    expect(saved.activeView).toBe('files');
  });
});

describe('useShellLayout takeover memory (shell-r10-01)', () => {
  const LV = [...VIEWS, 'learning'];
  afterEach(() => { useLearnStore.setState({ isLearnMode: false }); });

  it('saves the lesson takeover so leaving a mode and coming back reopens it', async () => {
    const platform = fakePlatform();
    renderHook(() => useShellLayout({ platform: platform as never, mode: 'learn', validViews: LV, canCollapseSidebar: true }));
    await waitFor(() => expect(platform.getStoredValue).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    vi.useFakeTimers();
    act(() => { useNavigationStore.getState().selectView('learning', { toggle: false }); });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(platform.store.get('layout_shell:learn')).toMatchObject({ takeover: 'learning', activeView: null });
  });

  it('re-enters the saved takeover on hydrate', async () => {
    const platform = fakePlatform({ 'layout_shell:learn': { activeView: null, takeover: 'learning' } });
    renderHook(() => useShellLayout({ platform: platform as never, mode: 'learn', validViews: LV, canCollapseSidebar: true }));
    await waitFor(() => expect(useLearnStore.getState().isLearnMode).toBe(true));
    expect(useNavigationStore.getState().activeView).toBeNull();
    // The editor that held focus unmounted: hand focus to the takeover heading, not the mode chip.
    expect(focusAfterViewSelect).toHaveBeenCalledWith('learning');
  });
});

describe('useShellLayout responsive collapse', () => {
  it('folds Dirac below 1400 and the sidebar below 1000, restoring both when the window grows', async () => {
    const platform = fakePlatform();
    setWidth(900);
    renderHook(() => useShellLayout({ platform: platform as never, mode: 'research', validViews: VIEWS, canCollapseSidebar: true }));
    await waitFor(() => expect(useDiracPanelStore.getState().isOpen).toBe(false));
    expect(useNavigationStore.getState().activeView).toBeNull();
    act(() => { setWidth(1500); window.dispatchEvent(new Event('resize')); });
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('keeps Dirac open at 1400 and above', async () => {
    const platform = fakePlatform();
    setWidth(1400);
    renderHook(() => useShellLayout({ platform: platform as never, mode: 'research', validViews: VIEWS, canCollapseSidebar: true }));
    await waitFor(() => expect(platform.getStoredValue).toHaveBeenCalled());
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
  });
});
