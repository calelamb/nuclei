// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useRoomRetreat } from './useRoomRetreat';
import { useDiracPanelStore } from '../stores/diracPanelStore';
import { useNavigationStore } from '../stores/navigationStore';

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

beforeEach(() => {
  setViewport(900);
  useDiracPanelStore.setState({ isOpen: true, width: 320, autoCollapsed: false });
  useNavigationStore.setState({ activeView: null, autoCollapsedView: null });
});
afterEach(cleanup);

describe('useRoomRetreat (sidebar opened by hand while Dirac is open)', () => {
  it('folds Dirac to its rail when the sidebar would squeeze the editor under 420 px', () => {
    const { rerender } = renderHook((p: { sidebarOpen: boolean }) =>
      useRoomRetreat({ sidebarWidth: 240, vizWanted: false, canCollapseSidebar: true, sidebarOpen: p.sidebarOpen }),
    { initialProps: { sidebarOpen: false } });
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
    act(() => { useNavigationStore.setState({ activeView: 'files' }); });
    rerender({ sidebarOpen: true });
    expect(useDiracPanelStore.getState().isOpen).toBe(false);
  });

  it('keeps the sidebar the user just opened: folding Dirac for it must not fold the sidebar straight back out', () => {
    const { rerender } = renderHook((p: { sidebarOpen: boolean }) =>
      useRoomRetreat({ sidebarWidth: 240, vizWanted: true, canCollapseSidebar: true, sidebarOpen: p.sidebarOpen }),
    { initialProps: { sidebarOpen: false } });
    act(() => { useNavigationStore.setState({ activeView: 'files' }); });
    rerender({ sidebarOpen: true });
    expect(useDiracPanelStore.getState().isOpen).toBe(false);
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('leaves Dirac alone when everything fits', () => {
    setViewport(1440);
    const { rerender } = renderHook((p: { sidebarOpen: boolean }) =>
      useRoomRetreat({ sidebarWidth: 240, vizWanted: false, canCollapseSidebar: true, sidebarOpen: p.sidebarOpen }),
    { initialProps: { sidebarOpen: false } });
    rerender({ sidebarOpen: true });
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
  });

  it('does not fold Dirac on first render when the sidebar is already open (the Dirac-keyed retreat owns that case)', () => {
    renderHook(() => useRoomRetreat({ sidebarWidth: 240, vizWanted: false, canCollapseSidebar: true, sidebarOpen: true }));
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
  });
});
