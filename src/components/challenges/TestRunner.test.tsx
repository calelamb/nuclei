// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./ChallengeInspector', () => ({ ChallengeInspector: () => <div>inspector</div> }));
const run = vi.hoisted(() => ({
  results: [{ testCaseId: 't1', passed: false, verdict: 'wrong_answer', score: 0.5, executionTimeMs: 1 }] as Array<Record<string, unknown>>,
}));
const retry = vi.hoisted(() => vi.fn());
vi.mock('../../lib/kernelControl', () => ({ retryKernel: retry }));
vi.mock('../../services/challengeExecution', () => ({
  inspectChallengeCase: vi.fn(),
  runTestCases: vi.fn(async (...args: unknown[]) => {
    run.results.forEach((result, index) => (args[7] as (r: unknown, i: number) => void)(result, index));
    return run.results;
  }),
}));
const platformKind = vi.hoisted(() => ({ current: 'web' as 'web' | 'desktop' }));
vi.mock('../../platform/PlatformProvider', () => ({ usePlatform: () => ({ isDesktop: true, getPlatform: () => platformKind.current }) }));

import { TestRunner } from './TestRunner';
import { useEditorStore } from '../../stores/editorStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';

const CHALLENGE = {
  id: 'c1', title: 'T', testCases: [{ id: 't1', label: 'Case 1', weight: 1, hidden: false, validation: { type: 'probability_match', expected: {}, tolerance: 0.1 } }],
  starterCode: { qiskit: '' },
} as never;

const DEFAULT_RESULTS = [{ testCaseId: 't1', passed: false, verdict: 'wrong_answer', score: 0.5, executionTimeMs: 1 }];
beforeEach(() => {
  run.results = DEFAULT_RESULTS;
  retry.mockClear();
  useEditorStore.setState({ kernelStatus: 'ready', kernelError: null, kernelProgress: null });
  useChallengeModeStore.setState({ currentTestResults: [], progress: {} });
});
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

describe('TestRunner focus contract (learn-r11-04)', () => {
  it('keeps Run focusable (aria-disabled, not disabled) while it works', async () => {
    render(<TestRunner challenge={CHALLENGE} />);
    const runButton = screen.getByRole('button', { name: /Run visible tests/ });
    runButton.focus();
    fireEvent.click(runButton);
    const busy = screen.getByRole('button', { name: /Running/ });
    expect(busy.hasAttribute('disabled')).toBe(false);
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(busy);
    await waitFor(() => expect(screen.getByRole('button', { name: /Run visible tests/ })).toBeTruthy());
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

const TWO_CASES = {
  id: 'c2', title: 'T', starterCode: { qiskit: '' },
  testCases: ['t1', 't2'].map((id) => ({ id, label: id, weight: 1, hidden: false, validation: { type: 'state_fidelity' } })),
} as never;
const SYNTAX = (id: string) => ({
  testCaseId: id, passed: false, score: 0, verdict: 'compile_error', executionTimeMs: 1,
  message: "SyntaxError: unmatched ')'", errorLine: 5,
});

describe('TestRunner when the code does not run (learn-r10-03)', () => {
  it('shows one banner with the line, neutral Not run rows, and no red zeros', async () => {
    run.results = [SYNTAX('t1'), SYNTAX('t2')];
    render(<TestRunner challenge={TWO_CASES} />);
    fireEvent.click(screen.getByRole('button', { name: /Run visible tests/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Your code didn't run (line 5)"));
    expect(screen.getAllByText('Not run')).toHaveLength(2);
    expect(screen.queryByText(/fidelity 0%|match 0%/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('0 of 2 cases ran');
  });
});

describe('TestRunner scores (learn-r10-01)', () => {
  it("labels a graded state 'fidelity'", async () => {
    run.results = [{ testCaseId: 't1', passed: false, score: 0, verdict: 'wrong_answer', message: 'x', executionTimeMs: 1 }];
    render(<TestRunner challenge={TWO_CASES} />);
    fireEvent.click(screen.getByRole('button', { name: /Run visible tests/ }));
    await waitFor(() => expect(screen.getByText('fidelity 0%')).toBeTruthy());
  });
});

describe('TestRunner when Python never started (learn-r10-02)', () => {
  it('says Python did not start with Retry and records no submission', async () => {
    run.results = [
      { testCaseId: 't1', passed: false, score: 0, verdict: 'runtime_error', engineUnavailable: true, message: "Python didn't start. x", executionTimeMs: 0 },
      { testCaseId: 't2', passed: false, score: 0, verdict: 'runtime_error', engineUnavailable: true, message: "Python didn't start. x", executionTimeMs: 0 },
    ];
    render(<TestRunner challenge={TWO_CASES} />);
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(screen.getByText("Python didn't start")).toBeTruthy());
    expect(useChallengeModeStore.getState().progress['c2']?.submissions ?? []).toHaveLength(0);
    expect(screen.queryByText(/Runtime error|Score:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
    expect(retry).toHaveBeenCalled();
  });

  it('shows the shared failed state up front, and Run retries instead of attempting', () => {
    useEditorStore.setState({ kernelStatus: 'failed', kernelError: "Couldn't start the browser Python engine. Check your connection or content blocker, then retry." });
    render(<TestRunner challenge={TWO_CASES} />);
    expect(screen.getByText("Python didn't start")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Run visible tests/ }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('TestRunner while Python boots (learn-r10-04)', () => {
  it('puts the boot step in the action row, saying Python on the web', () => {
    useEditorStore.setState({ kernelStatus: 'connecting', kernelProgress: { step: 1, total: 3, label: 'Downloading Python', fraction: 0.1 } as never });
    render(<TestRunner challenge={TWO_CASES} />);
    expect(screen.getByText(/Starting Python 1\/3/)).toBeTruthy();
  });
});
