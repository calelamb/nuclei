// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';
import { useThemeStore } from '../../stores/themeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useHelpOverlayStore } from '../../stores/helpOverlayStore';
import { useWhatsNewStore } from '../../stores/whatsNewStore';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof window.requestAnimationFrame;
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  useThemeStore.getState().setMode('dark');
  useWorkspaceStore.setState({ mode: 'research' });
  useNavigationStore.setState({ settingsTarget: null, activeView: 'settings' });
});
afterEach(cleanup);

describe('SettingsPanel', () => {
  it('offers System, Dark and Light themes and applies System (shell-23)', () => {
    render(<SettingsPanel />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['System', 'Dark', 'Light']);
    fireEvent.click(within(group).getByRole('radio', { name: 'System' }));
    expect(useThemeStore.getState().preference).toBe('system');
    // matchMedia stub says the OS prefers dark.
    expect(useThemeStore.getState().mode).toBe('dark');
  });

  it('every toggle is a named switch exposing its state (interaction-10)', () => {
    render(<SettingsPanel />);
    const switches = screen.getAllByRole('switch', { hidden: true });
    expect(switches.length).toBeGreaterThan(8);
    for (const sw of switches) {
      expect(sw.getAttribute('aria-checked')).not.toBeNull();
      expect(sw.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('has a Workspace section that switches mode through the guard and replays the tour (shell-23)', () => {
    render(<SettingsPanel />);
    const group = screen.getByRole('radiogroup', { name: 'Workspace mode' });
    expect(within(group).getByRole('radio', { name: 'Research' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: 'Learn' }));
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });

  it('has a Help section with shortcuts, release notes and the version (shell-23)', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Help/i }));
    fireEvent.click(screen.getByRole('button', { name: /View/ }));
    expect(useHelpOverlayStore.getState().shortcutsOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Release notes' }));
    expect(useWhatsNewStore.getState().requested).toBe(true);
    expect(screen.getByText(/^Nuclei v/)).toBeTruthy();
  });

  it('opened from the Dirac CTA it expands the Dirac AI section and focuses the key field (interaction-16)', async () => {
    const dirac = (name: RegExp) => screen.getByRole('button', { name });
    render(<SettingsPanel />);
    expect(dirac(/Dirac AI/i).getAttribute('aria-expanded')).toBe('false');
    useNavigationStore.getState().openSettings();
    await waitFor(() => expect(dirac(/Dirac AI/i).getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Anthropic API key')));
  });

  it('collapsed sections are not tabbable', () => {
    render(<SettingsPanel />);
    const diracBody = document.getElementById(screen.getByRole('button', { name: /Dirac AI/i }).getAttribute('aria-controls') as string);
    expect(diracBody?.hasAttribute('inert')).toBe(true);
  });

  it('keeps arrow-key selection inside the theme radio group', () => {
    const spy = vi.spyOn(window, 'requestAnimationFrame');
    render(<SettingsPanel />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(useThemeStore.getState().preference).toBe('light'); // dark -> light
    spy.mockRestore();
  });
});
