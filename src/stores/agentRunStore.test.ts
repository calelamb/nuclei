import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRunResult, JournalEntry, PatchTransaction } from '../services/agent/types';
import { useAgentRunStore } from './agentRunStore';

function tx(overrides: Partial<PatchTransaction> = {}): PatchTransaction {
  return {
    id: 'txn_1',
    path: 'editor',
    beforeContent: 'before',
    afterContent: 'after',
    beforeHash: 'h1',
    afterHash: 'h2',
    appliedAt: 0,
    rolledBack: false,
    ...overrides,
  };
}

describe('agentRunStore', () => {
  beforeEach(() => {
    useAgentRunStore.getState().reset();
  });

  it('beginRun starts a fresh run in the planning state', () => {
    useAgentRunStore.getState().beginRun('build a bell state', 'run_1');
    const { activeRun, isRunning } = useAgentRunStore.getState();

    expect(isRunning).toBe(true);
    expect(activeRun).toEqual({
      runId: 'run_1',
      goal: 'build a bell state',
      state: 'planning',
      iterations: 0,
      journal: [],
      patches: [],
    });
  });

  it('appendJournal appends the entry and updates state on state_change entries', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    const entry: JournalEntry = { kind: 'state_change', ts: 1, from: 'planning', to: 'working' };
    useAgentRunStore.getState().appendJournal(entry);

    const { activeRun } = useAgentRunStore.getState();
    expect(activeRun?.state).toBe('working');
    expect(activeRun?.journal).toEqual([entry]);
  });

  it('appendJournal increments iterations on tool_call entries only', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    useAgentRunStore.getState().appendJournal({ kind: 'model_text', ts: 1, text: 'thinking' });
    expect(useAgentRunStore.getState().activeRun?.iterations).toBe(0);

    useAgentRunStore.getState().appendJournal({
      kind: 'tool_call',
      ts: 2,
      toolCallId: 'c1',
      tool: 'run_simulation',
      input: {},
    });
    expect(useAgentRunStore.getState().activeRun?.iterations).toBe(1);

    useAgentRunStore.getState().appendJournal({
      kind: 'tool_result',
      ts: 3,
      evidence: { toolCallId: 'c1', tool: 'run_simulation', ok: true, facts: {} },
    });
    expect(useAgentRunStore.getState().activeRun?.iterations).toBe(1);
  });

  it('appendJournal is a no-op when there is no active run', () => {
    useAgentRunStore.getState().appendJournal({ kind: 'error', ts: 1, message: 'boom' });
    expect(useAgentRunStore.getState().activeRun).toBeNull();
  });

  it('setState overwrites the active run state directly', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    useAgentRunStore.getState().setState('cancelled');
    expect(useAgentRunStore.getState().activeRun?.state).toBe('cancelled');
  });

  it('setState is a no-op when there is no active run', () => {
    useAgentRunStore.getState().setState('failed');
    expect(useAgentRunStore.getState().activeRun).toBeNull();
  });

  it('recordPatch appends a new transaction', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    useAgentRunStore.getState().recordPatch(tx());
    expect(useAgentRunStore.getState().activeRun?.patches).toEqual([tx()]);
  });

  it('recordPatch upserts an existing transaction by id (e.g. after a rollback)', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    useAgentRunStore.getState().recordPatch(tx());
    useAgentRunStore.getState().recordPatch(tx({ rolledBack: true }));

    const { activeRun } = useAgentRunStore.getState();
    expect(activeRun?.patches).toHaveLength(1);
    expect(activeRun?.patches[0].rolledBack).toBe(true);
  });

  it('finishRun updates state/iterations/journal/success/summary and clears isRunning while preserving patches', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    useAgentRunStore.getState().recordPatch(tx());

    const journal: JournalEntry[] = [{ kind: 'error', ts: 1, message: 'done' }];
    const result: AgentRunResult = {
      runId: 'run_1',
      state: 'completed',
      success: true,
      iterations: 3,
      summary: 'Verified.',
      journal,
    };
    useAgentRunStore.getState().finishRun(result);

    const { activeRun, isRunning } = useAgentRunStore.getState();
    expect(isRunning).toBe(false);
    expect(activeRun?.state).toBe('completed');
    expect(activeRun?.iterations).toBe(3);
    expect(activeRun?.journal).toEqual(journal);
    expect(activeRun?.success).toBe(true);
    expect(activeRun?.summary).toBe('Verified.');
    expect(activeRun?.patches).toEqual([tx()]);
  });

  it('finishRun synthesizes an activeRun when none exists yet (e.g. an early guard-rail failure)', () => {
    const result: AgentRunResult = {
      runId: 'run_2',
      state: 'failed',
      success: false,
      iterations: 0,
      summary: 'Agent mode requires the desktop app.',
      journal: [],
    };
    useAgentRunStore.getState().finishRun(result);

    const { activeRun, isRunning } = useAgentRunStore.getState();
    expect(isRunning).toBe(false);
    expect(activeRun).toEqual({
      runId: 'run_2',
      goal: '',
      state: 'failed',
      iterations: 0,
      journal: [],
      patches: [],
      success: false,
      summary: 'Agent mode requires the desktop app.',
    });
  });

  it('reset clears the active run and running flag', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    useAgentRunStore.getState().reset();
    expect(useAgentRunStore.getState().activeRun).toBeNull();
    expect(useAgentRunStore.getState().isRunning).toBe(false);
  });

  it('mutations are immutable — appendJournal produces a new journal array, not an in-place push', () => {
    useAgentRunStore.getState().beginRun('goal', 'run_1');
    const before = useAgentRunStore.getState().activeRun?.journal;
    useAgentRunStore.getState().appendJournal({ kind: 'error', ts: 1, message: 'x' });
    const after = useAgentRunStore.getState().activeRun?.journal;
    expect(before).not.toBe(after);
  });
});
