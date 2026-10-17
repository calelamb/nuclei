// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { DiracSidePanel } from './DiracSidePanel';
import { useDiracStore } from '../../stores/diracStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

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

  it('escape closes the slash menu without leaving the field', () => {
    resetStores('sk-ant-test');
    render(<DiracSidePanel />);
    const box = screen.getByLabelText('Message Dirac');
    fireEvent.change(box, { target: { value: '/' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the collapsed rail opens with Space as well as Enter (learn-22)', () => {
    resetStores('sk-ant-test');
    useDiracPanelStore.setState({ isOpen: false });
    render(<DiracSidePanel />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open Dirac panel' }), { key: ' ' });
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
});
