// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
