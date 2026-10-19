// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LessonRunButton } from './LessonRunButton';
import { useEditorStore } from '../../stores/editorStore';

afterEach(() => { cleanup(); useEditorStore.setState({ kernelInstalling: null }); });

describe('LessonRunButton', () => {
  it('keeps keyboard focus when a press starts the run (the button is busy, not disabled)', () => {
    const { rerender } = render(<LessonRunButton isRunning={false} pythonLoading={false} stage={null} onRun={() => {}} />);
    const btn = screen.getByRole('button', { name: /Run/ });
    btn.focus();
    rerender(<LessonRunButton isRunning pythonLoading={false} stage={null} onRun={() => {}} />);
    const busy = screen.getByRole('button', { name: /Running/ });
    expect(busy).toBe(btn);
    expect(document.activeElement).toBe(busy);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect((busy as HTMLButtonElement).disabled).toBe(false);
  });

  it('promises cancel and a toggle state only when it can cancel', () => {
    const progress = { step: 1, total: 3, label: 'Downloading Python', fraction: 0 };
    const { rerender } = render(<LessonRunButton isRunning pythonLoading progress={progress} onRun={() => {}} />);
    const noCancel = screen.getByRole('button');
    expect(noCancel.getAttribute('aria-pressed')).toBeNull();
    expect(noCancel.getAttribute('title') ?? '').not.toMatch(/cancel/i);
    rerender(<LessonRunButton isRunning pythonLoading progress={progress} onRun={() => {}} onCancelQueued={() => {}} />);
    const cancellable = screen.getByRole('button');
    expect(cancellable.getAttribute('aria-pressed')).toBe('true');
    expect(cancellable.getAttribute('title') ?? '').toMatch(/cancel/i);
  });

  it('ignores a second press while running', () => {
    let runs = 0;
    render(<LessonRunButton isRunning pythonLoading stage="Loading NumPy" onRun={() => { runs += 1; }} />);
    screen.getByRole('button', { name: /Loading Python/ }).click();
    expect(runs).toBe(0);
  });

  it('names the package while it installs instead of saying Running (learn-r9-07)', () => {
    useEditorStore.setState({ kernelInstalling: 'Cirq' });
    render(<LessonRunButton isRunning pythonLoading={false} progress={null} onRun={() => {}} />);
    expect(screen.getByRole('button', { name: 'Installing Cirq…' })).toBeTruthy();
  });
});
