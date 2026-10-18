// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./ChallengeInspector', () => ({ ChallengeInspector: () => <div>inspector</div> }));
const FAILED = { testCaseId: 't1', passed: false, verdict: 'wrong_answer', score: 0.5, executionTimeMs: 1 };
vi.mock('../../services/challengeExecution', () => ({
  inspectChallengeCase: vi.fn(),
  runTestCases: vi.fn(async (...args: unknown[]) => {
    (args[7] as (r: unknown, i: number) => void)(FAILED, 0);
    return [FAILED];
  }),
}));
vi.mock('../../platform/PlatformProvider', () => ({ usePlatform: () => ({ isDesktop: true, getPlatform: () => 'desktop' }) }));

import { TestRunner } from './TestRunner';

const CHALLENGE = {
  id: 'c1', title: 'T', testCases: [{ id: 't1', label: 'Case 1', weight: 1, hidden: false }],
  starterCode: { qiskit: '' },
} as never;

afterEach(cleanup);

describe('TestRunner result tabs', () => {
  it('links tabs to a tabpanel and switches with the arrow keys', async () => {
    render(<TestRunner challenge={CHALLENGE} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
    const panel = screen.getByRole('tabpanel');
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('tab')[1]));
    expect(screen.getByText('inspector')).toBeTruthy();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getAllByRole('tab')[1].id);
  });
});

describe('TestRunner verdict', () => {
  it('reserves the verdict pill for Submit and reports pass counts for visible runs', async () => {
    render(<TestRunner challenge={CHALLENGE} />);
    expect(screen.getByRole('button', { name: /Run visible tests/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Run visible tests/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('0 of 1 visible cases passed'));
    expect(screen.queryByText('Wrong answer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Wrong answer'));
  });
});
