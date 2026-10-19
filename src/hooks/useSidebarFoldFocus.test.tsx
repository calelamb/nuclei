// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useSidebarFoldFocus } from './useSidebarFoldFocus';
import { noteDiracClaimedRoom, consumeDiracClaimedRoom } from './sidebarFoldReason';
import { useNavigationStore } from '../stores/navigationStore';

function Shell() {
  useSidebarFoldFocus();
  const view = useNavigationStore((s) => s.activeView);
  return (
    <div>
      <button data-tour-target="activity-settings">Settings</button>
      {view && <div data-tour-sidebar=""><button data-testid="inside">Appearance</button></div>}
    </div>
  );
}

afterEach(() => { cleanup(); useNavigationStore.setState({ activeView: 'files', autoCollapsedView: null }); });

describe('useSidebarFoldFocus', () => {
  it('lands focus on the rail button when the sidebar folds for room while it held focus', async () => {
    useNavigationStore.setState({ activeView: 'settings', autoCollapsedView: null });
    const { getByTestId, getByText } = render(<Shell />);
    act(() => { getByTestId('inside').focus(); });
    act(() => { useNavigationStore.setState({ activeView: null, autoCollapsedView: 'settings' }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(document.activeElement).toBe(getByText('Settings'));
  });

  it('leaves focus alone when focus was outside the sidebar', async () => {
    useNavigationStore.setState({ activeView: 'settings', autoCollapsedView: null });
    const { getByText } = render(<Shell />);
    const other = document.createElement('input');
    document.body.appendChild(other);
    act(() => { other.focus(); });
    act(() => { useNavigationStore.setState({ activeView: null, autoCollapsedView: 'settings' }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(getByText('Settings'));
    other.remove();
  });

  it('does not race Dirac to the rail button when Dirac claimed the room', async () => {
    useNavigationStore.setState({ activeView: 'settings', autoCollapsedView: null });
    const { getByTestId, getByText } = render(<Shell />);
    act(() => { getByTestId('inside').focus(); });
    act(() => {
      noteDiracClaimedRoom();
      useNavigationStore.setState({ activeView: null, autoCollapsedView: 'settings' });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(document.activeElement).not.toBe(getByText('Settings'));
    expect(consumeDiracClaimedRoom()).toBe(false);
  });
});
