// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act, waitFor } from '@testing-library/react';
import { DiracSidePanel } from './DiracSidePanel';
import { useDiracStore } from '../../stores/diracStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNavigationStore } from '../../stores/navigationStore';

function resetStores(apiKey: string | null) {
  useDiracStore.setState({ messages: [], isLoading: false, apiKey, conversationMeta: null });
  useDiracPanelStore.setState({ isOpen: true, pendingPrompt: null, keyEntryOpen: false });
  useWorkspaceStore.setState({ mode: 'learn' });
}

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }) as unknown as MediaQueryList);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiracSidePanel', () => {
  it('sends a question queued with ask() once connected (learn-03)', async () => {
    resetStores('sk-ant-test');
    const fetchMock = stubFetch();
    render(<DiracSidePanel />);
    await act(async () => { useDiracPanelStore.getState().ask('Can you explain "Superposition" in more detail?'); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useDiracStore.getState().messages[0]).toMatchObject({
      role: 'user', content: 'Can you explain "Superposition" in more detail?',
    });
    expect(useDiracPanelStore.getState().pendingPrompt).toBeNull();
  });

  it('without a key it saves nothing, explains why, and sends after connecting (learn-03, learn-23)', async () => {
    resetStores(null);
    const fetchMock = stubFetch();
    render(<DiracSidePanel />);
    await act(async () => { useDiracPanelStore.getState().ask('Explain entanglement'); });
    expect(useDiracStore.getState().messages).toHaveLength(0);
    expect(screen.getByText(/to get an answer to/i).textContent).toContain('Explain entanglement');
    // Agent controls are not shown without a key.
    expect(screen.queryByLabelText('Agent goal')).toBeNull();

    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'sk-ant-abc' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(useDiracStore.getState().apiKey).toBe('sk-ant-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed key inline', () => {
    resetStores(null);
    render(<DiracSidePanel />);
    fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toMatch(/sk-ant-/);
    expect(useDiracStore.getState().apiKey).toBeNull();
  });

  it('tells the learner to paste a key when Save is pressed empty', () => {
    resetStores(null);
    render(<DiracSidePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toBe('Paste your Anthropic API key first.');
    expect(useDiracStore.getState().apiKey).toBeNull();
  });

  it('moves focus to the message box once a key is saved, not to the body', async () => {
    resetStores(null);
    render(<DiracSidePanel />);
    const field = screen.getByLabelText('Anthropic API key');
    field.focus();
    fireEvent.change(field, { target: { value: 'sk-ant-abc' } });
    await act(async () => { fireEvent.submit(field.closest('form')!); });
    expect(useDiracStore.getState().apiKey).toBe('sk-ant-abc');
    expect(document.activeElement).toBe(screen.getByLabelText('Message Dirac'));
  });

  it('keeps keyboard focus in the message box while a reply is loading (interaction-r-01)', async () => {
    resetStores('sk-ant-test');
    let release: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((res) => { release = res; })));
    render(<DiracSidePanel />);
    const box = screen.getByLabelText('Message Dirac') as HTMLTextAreaElement;
    box.focus();
    fireEvent.change(box, { target: { value: 'hello' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(useDiracStore.getState().isLoading).toBe(true);
    expect(document.activeElement).toBe(box);
    expect(box.disabled).toBe(false);
    expect(box.getAttribute('aria-busy')).toBe('true');
    await act(async () => { release(new Response('{}', { status: 429 })); });
    await waitFor(() => expect(useDiracStore.getState().isLoading).toBe(false));
    expect(document.activeElement).toBe(box);
  });

  it('shows each message at its own timestamp, not the current time (learn-04)', () => {
    resetStores('sk-ant-test');
    useDiracStore.setState({
      messages: [{ id: 'a', role: 'user', content: 'hello', timestamp: new Date(2025, 0, 5, 3, 7).toISOString() }],
    });
    render(<DiracSidePanel />);
    expect(screen.getByText(/Jan 5, 2025, 3:07/)).toBeTruthy();
  });

  it('uses the research persona in Research mode (research-23)', () => {
    resetStores('sk-ant-test');
    useWorkspaceStore.setState({ mode: 'research' });
    render(<DiracSidePanel />);
    expect(screen.getByText('Your research collaborator.')).toBeTruthy();
    expect(screen.queryByText(/quantum computing tutor/i)).toBeNull();
    expect(screen.getByText('Summarize the last sweep')).toBeTruthy();
  });

  it('shows an experiment context chip only in Research (research-23)', () => {
    resetStores('sk-ant-test');
    const { unmount } = render(<DiracSidePanel />);
    expect(screen.queryByText('experiment')).toBeNull();
    unmount();
    useWorkspaceStore.setState({ mode: 'research' });
    render(<DiracSidePanel />);
    expect(screen.getByText('experiment')).toBeTruthy();
  });

  it('navigates the slash menu with the keyboard and never sends a bare slash (learn-22)', () => {
    resetStores('sk-ant-test');
    const fetchMock = stubFetch();
    render(<DiracSidePanel />);
    const box = screen.getByLabelText('Message Dirac') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '/' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('/fix ');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: '/zzz' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useDiracStore.getState().messages).toHaveLength(0);
  });

  it('sends complete slash commands and hints at unknown ones (review learn-22)', () => {
    resetStores('sk-ant-test');
    const fetchMock = stubFetch();
    render(<DiracSidePanel />);
    const box = screen.getByLabelText('Message Dirac') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '/zzz' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByRole('status').textContent).toMatch(/Unknown command/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '/explain' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('');
    expect(useDiracStore.getState().messages.length).toBeGreaterThan(0);
  });

  it('escape closes the slash menu without leaving the field', () => {
    resetStores('sk-ant-test');
    render(<DiracSidePanel />);
    const box = screen.getByLabelText('Message Dirac');
    fireEvent.change(box, { target: { value: '/' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the collapsed rail is a native button, so Space and Enter open it (learn-22)', () => {
    resetStores('sk-ant-test');
    useDiracPanelStore.setState({ isOpen: false });
    render(<DiracSidePanel />);
    const rail = screen.getByRole('button', { name: 'Open Dirac panel' });
    expect(rail.tagName).toBe('BUTTON');
    fireEvent.click(rail);
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
  });

  it('renders a rejected key as a friendly card with an Update key action (learn-14)', () => {
    resetStores('sk-ant-test');
    useDiracStore.setState({
      messages: [
        { id: 'u', role: 'user', content: 'hi', timestamp: new Date().toISOString() },
        {
          id: 'e', role: 'assistant', content: '', timestamp: new Date().toISOString(),
          error: { kind: 'auth', title: 'Your Anthropic key was rejected', message: 'Check it.', action: 'update-key', details: 'HTTP 401' },
        },
      ],
    });
    render(<DiracSidePanel />);
    expect(screen.getByText('Your Anthropic key was rejected')).toBeTruthy();
    expect(screen.queryByText(/authentication_error/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Update key/ }));
    expect(useDiracPanelStore.getState().keyEntryOpen).toBe(true);
    expect(screen.getByLabelText('Anthropic API key')).toBeTruthy();
  });

  it('shows the agent entry only where the UI mode has the agentEntry feature', () => {
    resetStores('sk-ant-test');
    const agentEntry = (c: HTMLElement) => c.querySelector('[aria-label="Agent goal"], .dirac-agent-note');
    useUIModeStore.setState({ mode: 'beginner' });
    const beginner = render(<DiracSidePanel />);
    expect(agentEntry(beginner.container)).toBeNull();
    beginner.unmount();
    useUIModeStore.setState({ mode: 'advanced' });
    const advanced = render(<DiracSidePanel />);
    expect(agentEntry(advanced.container)).not.toBeNull();
    advanced.unmount();
    useUIModeStore.setState({ mode: 'intermediate' });
  });

  it('focuses the API key field when asked to focus Dirac with no key (⌘L)', async () => {
    resetStores(null);
    render(<DiracSidePanel />);
    act(() => { useDiracPanelStore.getState().focusInput(); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Anthropic API key')));
  });

  it('opens the Dirac settings section from the no-key footer link', () => {
    resetStores(null);
    const openSettings = vi.fn();
    useNavigationStore.setState({ openSettings });
    render(<DiracSidePanel />);
    fireEvent.click(screen.getByRole('button', { name: /More Dirac settings/i }));
    expect(openSettings).toHaveBeenCalledWith('dirac');
  });

  it('advertises ambient narration, which is off by default', () => {
    resetStores('sk-ant-test');
    const openSettings = vi.fn();
    useNavigationStore.setState({ openSettings });
    render(<DiracSidePanel />);
    fireEvent.click(screen.getByRole('button', { name: /ambient narration/i }));
    expect(openSettings).toHaveBeenCalledWith('dirac');
  });

  it('hides the narration hint once ambient narration is on', () => {
    resetStores('sk-ant-test');
    const original = useSettingsStore.getState().dirac;
    useSettingsStore.setState({ dirac: { ...original, ambientNarration: true } });
    render(<DiracSidePanel />);
    expect(screen.queryByRole('button', { name: /ambient narration/i })).toBeNull();
    useSettingsStore.setState({ dirac: original });
  });
});
