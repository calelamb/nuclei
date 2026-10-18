// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LessonRunButton } from './LessonRunButton';

afterEach(cleanup);

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

  it('ignores a second press while running', () => {
    let runs = 0;
    render(<LessonRunButton isRunning pythonLoading stage="Loading NumPy" onRun={() => { runs += 1; }} />);
    screen.getByRole('button', { name: /Loading Python/ }).click();
    expect(runs).toBe(0);
  });
});
