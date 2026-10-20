// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { ProblemBrowser } from './ProblemBrowser';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { QUANTUM_CHALLENGES } from '../../data/challenges';

beforeEach(() => {
  useChallengeModeStore.setState({
    challenges: QUANTUM_CHALLENGES, progress: {}, practiceTab: 'all',
    difficultyFilter: null, categoryFilter: null, statusFilter: 'all', searchQuery: '',
  });
});
afterEach(cleanup);

describe('ProblemBrowser', () => {
  it('lists problems and opens one on click', () => {
    const setActiveProblem = vi.fn();
    useChallengeModeStore.setState({ setActiveProblem });
    render(<ProblemBrowser />);
    const first = QUANTUM_CHALLENGES[0];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(first.title) }));
    expect(setActiveProblem).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }));
  });

  it('shows the attempt summary instead of repeating the status', () => {
    const first = QUANTUM_CHALLENGES[0];
    useChallengeModeStore.setState({
      progress: { [first.id]: { status: 'attempted', attempts: 2, bestScore: 50 } as never },
    });
    render(<ProblemBrowser />);
    const row = screen.getByRole('button', { name: new RegExp(first.title) });
    expect(within(row).getAllByText(/attempted/i)).toHaveLength(1);
    expect(within(row).getByText('2 attempts, best 50%')).toBeTruthy();
  });

  it('switches practice track with tab semantics', () => {
    render(<ProblemBrowser />);
    const qkd = screen.getByRole('tab', { name: /QKD protocols/ });
    fireEvent.click(qkd);
    expect(useChallengeModeStore.getState().practiceTab).toBe('qkd');
  });
});
