// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SubmissionHistory } from './SubmissionHistory';
import type { Submission } from '../../types/challenge';

const make = (id: string, t: string): Submission => ({
  id, challengeId: 'c', code: '', framework: 'qiskit', timestamp: t,
  status: 'accepted', testCaseResults: [], totalScore: 1, executionTimeMs: 1,
});

describe('SubmissionHistory numbering', () => {
  afterEach(cleanup);
  it('numbers the oldest submission #1 and the newest #N', () => {
    render(<SubmissionHistory submissions={[make('a', '2026-01-01T00:00:00Z'), make('b', '2026-01-02T00:00:00Z')]} />);
    const labels = screen.getAllByText(/^#\d+$/).map((n) => n.textContent);
    expect(labels).toEqual(['#2', '#1']);
  });

  it('shows #1 for a single submission', () => {
    render(<SubmissionHistory submissions={[make('a', '2026-01-01T00:00:00Z')]} />);
    expect(screen.getByText('#1')).toBeTruthy();
  });
});
