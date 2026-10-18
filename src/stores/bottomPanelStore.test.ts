import { describe, it, expect, beforeEach } from 'vitest';
import { useBottomPanelStore } from './bottomPanelStore';
import { useLayoutStore } from './layoutStore';

const reset = () => useBottomPanelStore.setState({ collapsed: false, activeTab: 'terminal', unreadLines: 0 });

describe('bottomPanelStore output surfacing', () => {
  beforeEach(reset);

  it('keeps a user-collapsed Terminal collapsed on ordinary output and counts unread lines', () => {
    useBottomPanelStore.getState().setCollapsed(true);
    useBottomPanelStore.getState().noteOutput();
    useBottomPanelStore.getState().noteOutput();
    const s = useBottomPanelStore.getState();
    expect(s.collapsed).toBe(true);
    expect(s.unreadLines).toBe(2);
  });

  it('counts every line of a multi-line chunk', () => {
    useBottomPanelStore.getState().setCollapsed(true);
    useBottomPanelStore.getState().noteOutput(3);
    expect(useBottomPanelStore.getState().unreadLines).toBe(3);
  });

  it('counts unread when another tab is showing, without stealing the tab', () => {
    useBottomPanelStore.getState().setActiveTab('histogram');
    useBottomPanelStore.getState().noteOutput();
    expect(useBottomPanelStore.getState().activeTab).toBe('histogram');
    expect(useBottomPanelStore.getState().unreadLines).toBe(1);
  });

  it('does not count output as unread while the Terminal is visible', () => {
    useBottomPanelStore.getState().noteOutput();
    expect(useBottomPanelStore.getState().unreadLines).toBe(0);
  });

  it('opens the Terminal for an error even after the user collapsed it', () => {
    useBottomPanelStore.getState().setCollapsed(true);
    useBottomPanelStore.getState().noteOutput();
    useBottomPanelStore.getState().noteError();
    const s = useBottomPanelStore.getState();
    expect(s.collapsed).toBe(false);
    expect(s.activeTab).toBe('terminal');
    expect(s.unreadLines).toBe(0);
  });

  it('clears unread when the user expands the panel or selects the Terminal tab', () => {
    useBottomPanelStore.getState().setCollapsed(true);
    useBottomPanelStore.getState().noteOutput();
    useBottomPanelStore.getState().toggleCollapsed();
    expect(useBottomPanelStore.getState().unreadLines).toBe(0);
    useBottomPanelStore.getState().setActiveTab('histogram');
    useBottomPanelStore.getState().noteOutput();
    useBottomPanelStore.getState().setActiveTab('terminal');
    expect(useBottomPanelStore.getState().unreadLines).toBe(0);
  });

  it('does not override a terminal the user hid for ordinary output, but does for errors', () => {
    useLayoutStore.getState().setPanelOverride('terminal', false);
    useBottomPanelStore.getState().noteOutput();
    expect(useLayoutStore.getState().overrides.terminal).toBe(false);
    useBottomPanelStore.getState().noteError();
    expect(useLayoutStore.getState().overrides.terminal).toBeUndefined();
    useLayoutStore.getState().clearPanelOverride('terminal');
  });
});
