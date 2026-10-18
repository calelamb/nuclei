// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NewQecExperimentMenu } from './NewQecExperimentMenu';
import { QEC_TEMPLATES } from '../../services/qecTemplates';

const scaffold = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../../services/qecScaffold', () => ({ scaffoldQecExperiment: scaffold }));

describe('NewQecExperimentMenu', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('opens a dialog that Escape dismisses, returning focus to the QEC button', async () => {
    render(<NewQecExperimentMenu projectRoot="/p" />);
    const trigger = screen.getByRole('button', { name: 'New QEC experiment' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'New QEC experiment' })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('is a radiogroup operable with the arrow keys', () => {
    render(<NewQecExperimentMenu projectRoot="/p" />);
    fireEvent.click(screen.getByRole('button', { name: 'New QEC experiment' }));
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(QEC_TEMPLATES.length);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' });
    expect(screen.getAllByRole('radio')[1].getAttribute('aria-checked')).toBe('true');
  });

  it('scaffolds the chosen template under the typed name', async () => {
    render(<NewQecExperimentMenu projectRoot="/p" />);
    fireEvent.click(screen.getByRole('button', { name: 'New QEC experiment' }));
    fireEvent.change(screen.getByLabelText('Experiment name'), { target: { value: 'my memory' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
    expect(scaffold).toHaveBeenCalledWith(QEC_TEMPLATES[0], 'my memory', '/p');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
