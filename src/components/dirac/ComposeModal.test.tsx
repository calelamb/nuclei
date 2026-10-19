// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ComposeModal } from './ComposeModal';
import { useDiracStore } from '../../stores/diracStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useEditorStore } from '../../stores/editorStore';

afterEach(() => { cleanup(); useDiracStore.setState({ apiKey: '' }); });

describe('ComposeModal', () => {
  it('without a key, offers Add API key up front instead of failing after submit (interaction-r-03)', () => {
    useDiracStore.setState({ apiKey: '' });
    useDiracPanelStore.setState({ isOpen: false, focusSignal: 0 });
    const onClose = vi.fn();
    render(<ComposeModal open onClose={onClose} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add API key' }));
    expect(onClose).toHaveBeenCalled();
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
  });

  it('names the framework by its display name, not its id', () => {
    useDiracStore.setState({ apiKey: 'sk-ant-test' });
    useEditorStore.setState({ framework: 'qiskit' });
    render(<ComposeModal open onClose={() => {}} />);
    expect(screen.getByText(/Framework:/).textContent).toContain('Qiskit');
  });

  it('a rejected key reads like the chat panel, with Update key, and focus stays in the field', async () => {
    useDiracStore.setState({ apiKey: 'sk-ant-test' });
    useDiracPanelStore.setState({ keyEntryOpen: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })));
    const onClose = vi.fn();
    render(<ComposeModal open onClose={onClose} />);
    const field = screen.getByLabelText('Describe what Dirac should compose');
    field.focus();
    fireEvent.change(field, { target: { value: 'a ghz state' } });
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }); });
    expect(await screen.findByText('Your Anthropic key was rejected')).toBeTruthy();
    expect(screen.queryByText('invalid x-api-key')).toBeNull();
    expect(document.activeElement).toBe(field);
    // A rejected key is not a problem with the prompt text, so the field is not marked invalid (interaction-r-10).
    expect(field.getAttribute('aria-invalid')).not.toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Update key/ }));
    expect(onClose).toHaveBeenCalled();
    expect(useDiracPanelStore.getState().keyEntryOpen).toBe(true);
    vi.unstubAllGlobals();
  });

  it('without a key the dialog has a visible Close and the CTA is Dirac purple', () => {
    useDiracStore.setState({ apiKey: '' });
    const onClose = vi.fn();
    render(<ComposeModal open onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Add API key' }).className).toContain('dirac-btn-dirac');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
