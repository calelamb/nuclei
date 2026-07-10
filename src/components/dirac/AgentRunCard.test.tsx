// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { AgentRunCard } from './AgentRunCard';
import type { AgentRunUi } from '../../stores/agentRunStore';

afterEach(() => {
  cleanup();
});

function makeRun(overrides: Partial<AgentRunUi> = {}): AgentRunUi {
  return {
    runId: 'run_1',
    goal: 'Build a Bell state and verify 50/50 outcomes',
    state: 'working',
    iterations: 2,
    journal: [
      { kind: 'tool_call', ts: 1, toolCallId: 'c1', tool: 'apply_patch', input: {} },
      {
        kind: 'tool_result',
        ts: 2,
        evidence: { toolCallId: 'c1', tool: 'apply_patch', ok: true, facts: { path: 'bell.py' } },
      },
      {
        kind: 'tool_result',
        ts: 3,
        evidence: { toolCallId: 'c2', tool: 'run_simulation', ok: true, facts: { shotCount: 1024 } },
      },
    ],
    patches: [
      {
        id: 'txn_1',
        path: 'bell.py',
        beforeContent: 'a',
        afterContent: 'b',
        beforeHash: 'h1',
        afterHash: 'h2',
        appliedAt: 0,
        rolledBack: false,
      },
    ],
    ...overrides,
  };
}

describe('<AgentRunCard>', () => {
  it('renders goal, state badge, iteration count, and a summarized (non-JSON) timeline', () => {
    const run = makeRun();
    const { getByText, queryByText } = render(<AgentRunCard run={run} isRunning onStop={() => {}} />);

    expect(getByText(run.goal)).toBeTruthy();
    expect(getByText('Working')).toBeTruthy();
    expect(getByText('2 tool calls')).toBeTruthy();
    expect(getByText('apply_patch → bell.py')).toBeTruthy();
    expect(getByText('run_simulation → ok (1024 shots)')).toBeTruthy();
    // Never dumps raw JSON evidence into the timeline.
    expect(queryByText(/"toolCallId"/)).toBeNull();
  });

  it('shows a Stop button while running and calls onStop when clicked', () => {
    const onStop = vi.fn();
    const run = makeRun({ state: 'working' });
    const { getByText } = render(<AgentRunCard run={run} isRunning onStop={onStop} />);

    fireEvent.click(getByText('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('hides the Stop button once the run has completed', () => {
    const run = makeRun({ state: 'completed', success: true, summary: 'Verified 50/50 split.' });
    const { queryByText, getByText } = render(<AgentRunCard run={run} isRunning={false} onStop={() => {}} />);

    expect(queryByText('Stop')).toBeNull();
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Verified 50/50 split.')).toBeTruthy();
  });

  it('renders a Rollback button for an un-rolled-back patch and "Rolled back" once it is', () => {
    const run = makeRun();
    const { getByText, rerender } = render(<AgentRunCard run={run} isRunning onStop={() => {}} />);
    expect(getByText('Rollback')).toBeTruthy();

    const rolledBackRun = makeRun({ patches: [{ ...run.patches[0], rolledBack: true }] });
    rerender(<AgentRunCard run={rolledBackRun} isRunning onStop={() => {}} />);
    expect(getByText('Rolled back')).toBeTruthy();
  });
});
