import { describe, it, expect, beforeEach } from 'vitest';
import { useDiracPanelStore } from './diracPanelStore';
import { useNavigationStore } from './navigationStore';

beforeEach(() => {
  useDiracPanelStore.setState({ isOpen: true, autoCollapsed: false, lastNarrow: null });
  useNavigationStore.setState({ activeView: 'files', autoCollapsedView: null, lastNarrow: null });
});

describe('Dirac auto-collapse', () => {
  it('collapses to its tab when the window gets narrow and restores when it grows', () => {
    const dirac = useDiracPanelStore.getState();
    dirac.applyNarrow(true);
    expect(useDiracPanelStore.getState().isOpen).toBe(false);
    useDiracPanelStore.getState().applyNarrow(false);
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
    expect(useDiracPanelStore.getState().autoCollapsed).toBe(false);
  });

  it('does not reopen a panel the user closed themselves', () => {
    useDiracPanelStore.getState().close();
    useDiracPanelStore.getState().applyNarrow(true);
    useDiracPanelStore.getState().applyNarrow(false);
    expect(useDiracPanelStore.getState().isOpen).toBe(false);
  });

  it('respects a manual re-open while narrow (no fighting the user on every resize)', () => {
    useDiracPanelStore.getState().applyNarrow(true);
    useDiracPanelStore.getState().open();
    useDiracPanelStore.getState().applyNarrow(true);
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
  });

  it('a manual toggle while collapsed cancels the pending restore', () => {
    useDiracPanelStore.getState().applyNarrow(true);
    useDiracPanelStore.getState().toggle(); // user opens
    useDiracPanelStore.getState().toggle(); // user closes again
    useDiracPanelStore.getState().applyNarrow(false);
    expect(useDiracPanelStore.getState().isOpen).toBe(false);
  });
});

describe('sidebar auto-collapse', () => {
  it('collapses the sidebar when narrow and restores the same view when wide', () => {
    useNavigationStore.getState().applyNarrow(true, true);
    expect(useNavigationStore.getState().activeView).toBeNull();
    useNavigationStore.getState().applyNarrow(false, true);
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('never collapses a full-width takeover view', () => {
    useNavigationStore.setState({ activeView: 'qec' });
    useNavigationStore.getState().applyNarrow(true, false);
    expect(useNavigationStore.getState().activeView).toBe('qec');
  });

  it('leaves a view the user picked while narrow alone when the window grows', () => {
    useNavigationStore.getState().applyNarrow(true, true);
    useNavigationStore.getState().setActiveView('search');
    useNavigationStore.getState().applyNarrow(false, true);
    expect(useNavigationStore.getState().activeView).toBe('search');
  });
});

describe('setViewKeepingViewport (workspace switch while narrow)', () => {
  it('parks the view instead of re-opening the sidebar below the breakpoint', () => {
    useNavigationStore.getState().applyNarrow(true, true);
    useNavigationStore.getState().setViewKeepingViewport('files', true);
    expect(useNavigationStore.getState().activeView).toBeNull();
    useNavigationStore.getState().applyNarrow(false, true);
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('selects normally when the window is wide', () => {
    useNavigationStore.getState().applyNarrow(false, true);
    useNavigationStore.getState().setActiveView(null);
    useNavigationStore.getState().setViewKeepingViewport('files', true);
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('selects even when narrow if the sidebar cannot collapse (full-width view)', () => {
    useNavigationStore.getState().applyNarrow(true, false);
    useNavigationStore.getState().setViewKeepingViewport('search', false);
    expect(useNavigationStore.getState().activeView).toBe('search');
  });
});
