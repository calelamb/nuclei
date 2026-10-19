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
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Duplicate to edit/ }));
  });

  it('Cancel on the duplicate form also returns focus to its trigger', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Noise models' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /Duplicate to edit/ }));
    await screen.findByLabelText('Copy name');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Duplicate to edit/ }));
  });

  it('explains the dash when comparing against an entry-only model', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Noise models' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'biased_z' } });
    expect(screen.getByText(/entry-only model: no per-gate rates/)).toBeTruthy();
  });

  async function openLibrary(): Promise<void> {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Noise models' }));
    await screen.findByRole('dialog');
  }

  it('shows 0 for a channel a generator model leaves unset and keeps the dash for entry-only (qec-r-91)', async () => {
    await openLibrary();
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'measurement_heavy' } });
    const diff = screen.getByRole('table', { name: 'Generator argument differences' });
    const row = Array.from(diff.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('before_round_data_depolarization'));
    expect(Array.from(row?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['before_round_data_depolarization', '1', '0']);
    expect(diff.textContent).not.toContain('—');
    expect(screen.queryByText(/entry-only model/)).toBeNull();
    expect(screen.getByText(/0 means the channel is off/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'biased_z' } });
    expect(screen.getByRole('table', { name: 'Generator argument differences' }).textContent).toContain('—');
    expect(screen.getByText(/entry-only model/)).toBeTruthy();
    expect(screen.queryByText(/0 means the channel is off/)).toBeNull();
  });

  it('marks the selected row aria-current and tags the compare row (research-r-18)', async () => {
    await openLibrary();
    const list = screen.getAllByRole('button').filter((b) => b.classList.contains('nuclei-noise-row'));
    expect(list.filter((b) => b.getAttribute('aria-current') === 'true').map((b) => b.textContent)).toEqual(['uniform_depolarizing']);
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'SI1000' } });
    const compareRow = screen.getByRole('button', { name: /SI1000/ });
    expect(compareRow.textContent).toContain('compare');
    expect(compareRow.getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'biased_z' }));
    expect(screen.getByRole('button', { name: 'biased_z' }).getAttribute('aria-current')).toBe('true');
  });

  it('reserves plain headers for identifiers: prose headers take the overline (design-r12-04)', async () => {
    await openLibrary();
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'measurement_heavy' } });
    const heads = (name: string) => Array.from(screen.getByRole('table', { name }).querySelectorAll('th'));
    const plain = (th: Element) => th.classList.contains('nuclei-table__plain');
    expect(heads('Generator arguments').map(plain)).toEqual([false, false]);
    expect(heads('Generator argument differences').map(plain)).toEqual([false, true, true]);
  });
});
