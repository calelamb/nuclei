// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useDialogStore } from '../../stores/dialogStore';
import { UnsavedChangesModal } from './UnsavedChangesModal';

afterEach(() => { cleanup(); useDialogStore.setState({ pendingClose: null }); });

function open() {
  const handlers = { onSave: vi.fn(), onDontSave: vi.fn(), onCancel: vi.fn() };
  act(() => { useDialogStore.setState({ pendingClose: { fileName: 'bell.py', ...handlers } }); });
  return handlers;
}

describe('UnsavedChangesModal', () => {
  it('is a labelled modal that starts focus on the safe Cancel action', () => {
    render(<UnsavedChangesModal />);
    open();
    expect(screen.getByRole('dialog', { name: 'Save changes to bell.py?' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('maps Escape to Cancel, never to Don\'t save', () => {
    render(<UnsavedChangesModal />);
    const h = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onDontSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Save runs onSave and closes', async () => {
    render(<UnsavedChangesModal />);
    const h = open();
    await act(async () => { fireEvent.click(screen.getByText('Save')); });
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
