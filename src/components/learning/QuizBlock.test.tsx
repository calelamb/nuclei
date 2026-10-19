// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QuizBlock } from './QuizBlock';
import { useLearnStore } from '../../stores/learnStore';
import type { QuizQuestion } from '../../data/lessons/types';

const QUESTIONS: QuizQuestion[] = [
  { id: 'q1', question: 'How many states can a classical bit be in?', options: ['1', '2', '3'], correctIndex: 1, explanation: 'A bit is 0 or 1.' },
];

beforeEach(() => {
  useLearnStore.setState({ currentLessonId: 'lesson-1' });
});
afterEach(cleanup);

describe('QuizBlock', () => {
  it('exposes each question as a radio group of options', () => {
    render(<QuizBlock questions={QUESTIONS} />);
    const group = screen.getByRole('radiogroup', { name: /classical bit/i });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('lets a wrong answer be retried, then reveals the explanation and records the score', () => {
    const setQuizScore = vi.fn();
    useLearnStore.setState({ setQuizScore });
    render(<QuizBlock questions={QUESTIONS} />);
    fireEvent.click(screen.getByRole('radio', { name: /^B.*\b3\b|3/ }));
    expect(screen.getByText(/isn't the answer/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText(/isn't the answer/i)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /2/ }));
    expect(screen.getByText('A bit is 0 or 1.')).toBeTruthy();
    expect(setQuizScore).toHaveBeenCalledWith('lesson-1', 'q1', 1);
  });

  it('uses a roving tabindex and moves focus between options with the arrow keys', () => {
    render(<QuizBlock questions={QUESTIONS} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1], { key: 'End' });
    expect(document.activeElement).toBe(radios[2]);
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('keeps keyboard focus on the chosen option after Try again (learn-r9-06)', () => {
    render(<QuizBlock questions={QUESTIONS} />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(document.activeElement).toBe(screen.getAllByRole('radio')[2]);
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
  });

  it('keeps focus on the right answer after a correct pick instead of dropping to body', () => {
    render(<QuizBlock questions={QUESTIONS} />);
    const right = screen.getAllByRole('radio')[1];
    right.focus();
    fireEvent.click(right);
    expect(document.activeElement).toBe(right);
    expect(right.getAttribute('aria-disabled')).toBe('true');
    // A solved quiz cannot be re-answered.
    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect(screen.getAllByRole('radio')[1].getAttribute('aria-checked')).toBe('true');
  });

  it('wrong-answer copy does not repeat the Try again button', () => {
    render(<QuizBlock questions={QUESTIONS} />);
    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect(screen.queryByText(/try again!/i)).toBeNull();
  });
});
