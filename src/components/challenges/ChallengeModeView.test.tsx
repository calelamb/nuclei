// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

vi.mock('./ProblemBrowser', () => ({ ProblemBrowser: () => <div>browser</div> }));
vi.mock('./ProblemWorkspace', () => ({ ProblemWorkspace: () => <div>workspace</div> }));

import { ChallengeModeView } from './ChallengeModeView';
import { useChallengeModeStore } from '../../stores/challengeModeStore';

afterEach(() => {
  cleanup();
  useChallengeModeStore.setState({ activeProblem: null });
});

describe('ChallengeModeView', () => {
  it('offers Back on the problem list and leaves challenge mode', () => {
    const exitChallengeMode = vi.fn();
    useChallengeModeStore.setState({ activeProblem: null, exitChallengeMode });
    render(<ChallengeModeView />);
    expect(screen.getByText('browser')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(exitChallengeMode).toHaveBeenCalled();
  });

  it('offers Back inside a problem and returns to the list', () => {
    const setActiveProblem = vi.fn();
    useChallengeModeStore.setState({
      activeProblem: { id: 'p1', title: 'Bell State Factory' } as never,
      setActiveProblem,
    });
    render(<ChallengeModeView />);
    expect(screen.getByText('workspace')).toBeTruthy();
    expect(screen.getByText('Bell State Factory')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(setActiveProblem).toHaveBeenCalledWith(null);
  });

  it('makes the takeover title the programmatic landing H1 (shell-r10-02)', () => {
    render(<ChallengeModeView />);
    const title = screen.getByRole('heading', { level: 1, name: 'Quantum challenges' });
    expect(title.getAttribute('tabindex')).toBe('-1');
    expect(title.hasAttribute('data-landing')).toBe(true);
    // First heading in the takeover, so the keyboard landing query finds it before the list's own heading.
    expect(document.querySelector(':is(h1, h2)')).toBe(title);
  });
});
