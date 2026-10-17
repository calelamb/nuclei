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
    expect(screen.getByText(/not quite/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.queryByText(/not quite/i)).toBeNull();
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
});
