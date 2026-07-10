import { create } from 'zustand';
import type { AgentRunResult, AgentRunState, JournalEntry, PatchTransaction } from '../services/agent/types';

/**
 * Live, UI-facing view of a single Dirac agent run. Mirrors AgentRunResult's
 * shape but is mutable/incremental — populated in real time as the
 * orchestrator journals events (via StoreJournal), rather than only once
 * runAgent() resolves.
 */
export interface AgentRunUi {
  runId: string;
  goal: string;
  state: AgentRunState;
  /**
   * Live tool-call count while the run is in progress (an approximation —
   * it counts individual tool_call journal entries, which can be more than
   * one per model turn). Overwritten with the orchestrator's authoritative
   * per-turn count once the run finishes.
   */
  iterations: number;
  journal: JournalEntry[];
  patches: PatchTransaction[];
  success?: boolean;
  summary?: string;
}

interface AgentRunStoreState {
  activeRun: AgentRunUi | null;
  isRunning: boolean;
  beginRun: (goal: string, runId: string) => void;
  appendJournal: (entry: JournalEntry) => void;
  setState: (state: AgentRunState) => void;
  recordPatch: (tx: PatchTransaction) => void;
  finishRun: (result: AgentRunResult) => void;
  reset: () => void;
}

export const useAgentRunStore = create<AgentRunStoreState>((set) => ({
  activeRun: null,
  isRunning: false,

  beginRun: (goal, runId) =>
    set({
      activeRun: { runId, goal, state: 'planning', iterations: 0, journal: [], patches: [] },
      isRunning: true,
    }),

  appendJournal: (entry) =>
    set((s) => {
      if (!s.activeRun) return s;
      const state = entry.kind === 'state_change' ? entry.to : s.activeRun.state;
      const iterations = entry.kind === 'tool_call' ? s.activeRun.iterations + 1 : s.activeRun.iterations;
      return {
        activeRun: {
          ...s.activeRun,
          state,
          iterations,
          journal: [...s.activeRun.journal, entry],
        },
      };
    }),

  setState: (state) =>
    set((s) => (s.activeRun ? { activeRun: { ...s.activeRun, state } } : s)),

  recordPatch: (tx) =>
    set((s) => {
      if (!s.activeRun) return s;
      const idx = s.activeRun.patches.findIndex((p) => p.id === tx.id);
      const patches =
        idx === -1
          ? [...s.activeRun.patches, tx]
          : s.activeRun.patches.map((p, i) => (i === idx ? tx : p));
      return { activeRun: { ...s.activeRun, patches } };
    }),

  finishRun: (result) =>
    set((s) => ({
      activeRun: s.activeRun
        ? {
            ...s.activeRun,
            state: result.state,
            iterations: result.iterations,
            journal: result.journal,
            success: result.success,
            summary: result.summary,
          }
        : {
            runId: result.runId,
            goal: '',
            state: result.state,
            iterations: result.iterations,
            journal: result.journal,
            patches: [],
            success: result.success,
            summary: result.summary,
          },
      isRunning: false,
    })),

  reset: () => set({ activeRun: null, isRunning: false }),
}));
