// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { HardwareSweepGuard } from './HardwareSweepGuard';

afterEach(cleanup);

function renderGuard(pointCount: number) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <>
      <button type="button">Run</button>
      <HardwareSweepGuard experimentName="ibm-readout" backendLabel="ibm/brisbane" pointCount={pointCount} shots={100} onConfirm={onConfirm} onCancel={onCancel} />
    </>,
  );
  return { onCancel, onConfirm };
}

describe('HardwareSweepGuard keyboard model (LR-11)', () => {
  it('moves focus to Cancel when the dialog opens', () => {
    renderGuard(3);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('focuses the confirmation field instead when typing is required', () => {
    renderGuard(30);
    expect(document.activeElement).toBe(screen.getByPlaceholderText('ibm-readout'));
  });

  it('cancels on Escape', () => {
    const { onCancel } = renderGuard(3);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog', () => {
    renderGuard(3);
    const submit = screen.getByRole('button', { name: 'Submit to hardware' });
    submit.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });
});
