// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { API_KEY_PRIVACY_NOTE } from '../../config/apiKeyCopy';
import { SettingsPanel } from './SettingsPanel';
import { useThemeStore } from '../../stores/themeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useHelpOverlayStore } from '../../stores/helpOverlayStore';
import { useWhatsNewStore } from '../../stores/whatsNewStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useFrameworksStore } from '../../stores/frameworksStore';
import { requestSettingsFocus, takeSettingsFocusRequest } from './settingsFocus';

const platform = vi.hoisted(() => ({ web: false }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => platform.web }));

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
  platform.web = false;
  useUIModeStore.setState({ mode: 'intermediate' });
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

  it('focuses the key field when Settings mounts already holding the target (interaction-16, fresh open)', async () => {
    useNavigationStore.getState().openSettings();
    render(<SettingsPanel />);
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

  it('names the Parse Debounce slider after its row (unnamed range inputs fail screen readers)', () => {
    render(<SettingsPanel />);
    const slider = screen.getByRole('slider', { name: /Parse debounce/i });
    expect(slider.getAttribute('aria-valuetext')).toMatch(/ms/);
  });

  it('states the key privacy note once, identically to the Dirac connect card', () => {
    render(<SettingsPanel />);
    expect(screen.getByText(API_KEY_PRIVACY_NOTE)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/never leaves your machine/);
  });

  it('calls the Learn level "Level" (as the status bar and palette do), not "UI Mode"', () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useUIModeStore.setState({ mode: 'intermediate' });
    render(<SettingsPanel />);
    expect(screen.getByLabelText('Level')).toBeTruthy();
    expect(screen.queryByText('UI Mode')).toBeNull();
  });

  it('names each stepper after its row so "Decrease" is never ambiguous', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('button', { name: 'Decrease font size' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Increase font size' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Decrease' })).toBeNull();
  });

  it('renders the API key as the shared 32px TextInput with the reveal toggle inside it', () => {
    render(<SettingsPanel />);
    const key = screen.getByLabelText('Anthropic API key');
    expect(key.className).toContain('nuclei-input--lg');
    expect(key.closest('.nuclei-input-wrap')?.querySelector('button')?.getAttribute('aria-label')).toBe('Show API key');
  });

  it('moves focus into Settings when it is opened from the keyboard', async () => {
    const outside = document.createElement('textarea');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = render(<SettingsPanel />);
    requestSettingsFocus();
    await waitFor(() => expect(container.contains(document.activeElement)).toBe(true));
    outside.remove();
  });

  it('a request made before the panel mounts is honoured on mount, and consumed once', async () => {
    requestSettingsFocus();
    const { container } = render(<SettingsPanel />);
    await waitFor(() => expect(container.contains(document.activeElement)).toBe(true));
    expect(takeSettingsFocusRequest()).toBe(false);
  });

  it('takes focus back from a view that mounts after the panel and grabs it (editor from Challenges)', async () => {
    requestSettingsFocus();
    const { container } = render(<SettingsPanel />);
    await waitFor(() => expect(container.contains(document.activeElement)).toBe(true));
    const late = document.createElement('textarea');
    document.body.appendChild(late);
    late.focus();
    expect(container.contains(document.activeElement)).toBe(true);
    late.remove();
  });

  it('describes the Level row in one short line', () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    const { container } = render(<SettingsPanel />);
    expect(container.textContent).toContain('How much of the IDE is shown');
  });
});

describe('SettingsPanel platform and audience honesty (shell-r6-01, shell-r6-04)', () => {
  it('web: no setup wizard button, nothing opens the frameworks modal, and no Kernel section', () => {
    platform.web = true;
    render(<SettingsPanel />);
    expect(screen.queryByRole('button', { name: /setup wizard/i })).toBeNull();
    expect(screen.queryByText('Kernel')).toBeNull();
    expect(screen.getByText('Python')).toBeTruthy();
    useFrameworksStore.getState().openModal(false);
    expect(useFrameworksStore.getState().modalOpen).toBe(false);
  });

  it('web: the default framework list offers only what the browser can run', () => {
    platform.web = true;
    render(<SettingsPanel />);
    const select = screen.getByLabelText('Default framework') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['qiskit', 'cirq']);
  });

  it('desktop keeps the setup wizard button and the Kernel section', () => {
    render(<SettingsPanel />);
    expect(screen.getByRole('button', { name: /setup wizard/i })).toBeTruthy();
    expect(screen.getByText('Kernel')).toBeTruthy();
  });

  it('paid-hardware autonomy is hidden for beginners in Learn and on the web, shown in Research', () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useUIModeStore.setState({ mode: 'beginner' });
    const { unmount } = render(<SettingsPanel />);
    expect(screen.queryByText('Agent hardware autonomy')).toBeNull();
    unmount();
    useWorkspaceStore.setState({ mode: 'research' });
    const again = render(<SettingsPanel />);
    expect(screen.getByText('Agent hardware autonomy')).toBeTruthy();
    again.unmount();
    platform.web = true;
    render(<SettingsPanel />);
    expect(screen.queryByText('Agent hardware autonomy')).toBeNull();
  });
});
