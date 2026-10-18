// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { ProblemFilters } from './ProblemFilters';
import { useChallengeModeStore } from '../../stores/challengeModeStore';

afterEach(cleanup);

describe('ProblemFilters', () => {
  it('maps the All segment to a cleared filter and others to their value', () => {
    const setDifficultyFilter = vi.fn();
    const setCategoryFilter = vi.fn();
    const setStatusFilter = vi.fn();
    useChallengeModeStore.setState({
      difficultyFilter: 'hard', categoryFilter: null, statusFilter: 'all',
      setDifficultyFilter, setCategoryFilter, setStatusFilter,
    });
    render(<ProblemFilters />);
    const difficulty = screen.getByRole('radiogroup', { name: 'Difficulty' });
    expect(difficulty.querySelector('[aria-checked="true"]')?.textContent).toBe('Hard');
    fireEvent.click(screen.getByRole('radio', { name: 'Easy' }));
    expect(setDifficultyFilter).toHaveBeenCalledWith('easy');
    const hardGroupAll = difficulty.querySelector('[data-value="all"]') as HTMLElement;
    fireEvent.click(hardGroupAll);
    expect(setDifficultyFilter).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('radio', { name: 'State prep' }));
    expect(setCategoryFilter).toHaveBeenCalledWith('state-preparation');
    fireEvent.click(screen.getByRole('radio', { name: 'Solved' }));
    expect(setStatusFilter).toHaveBeenCalledWith('solved');
  });
});
