// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { NoiseModelLibrary } from './NoiseModelLibrary';

vi.mock('../../services/experimentFs', () => ({ createTauriExperimentFs: () => ({}) }));
vi.mock('../../services/experimentStore', () => ({
  discoverNoiseModels: vi.fn().mockResolvedValue({ models: [], validationErrors: [] }),
}));

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Noise models</button>
      {open && <NoiseModelLibrary projectRoot="/p" onClose={() => setOpen(false)} />}
    </>
  );
}

afterEach(() => cleanup());

describe('NoiseModelLibrary as a dialog (research-r-09)', () => {
  it('is a labelled modal with focus inside, and Escape returns focus to the trigger', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Noise models' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Noise model library' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape cancels the duplicate form first and keeps the library open', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Noise models' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Duplicate to edit/ }));
    const input = await screen.findByLabelText('Copy name');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Copy name')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('explains the dash when comparing against an entry-only model', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Noise models' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'biased_z' } });
    expect(screen.getByText(/entry-only model: no per-gate rates/)).toBeTruthy();
  });
});
