import { create } from 'zustand';
import type { RunProgress, RunSummary } from '../services/experimentRunner';

/**
 * PRD 09 Phase D (D4) — live sweep progress, shared across the Experiments
 * panel, the runs table, and the status bar's compact sweep indicator.
 *
 * Only one sweep runs at a time in v1 (the runner itself is sequential —
 * see PRD Constraint 6), so a single `active` slot is enough; callers that
 * want to start a run should check `active === null` first.
 *
 * `cancel` is a closure supplied by `useExperimentRun` at start time (it
 * flips the abort signal the runner polls between points) so any component
 * — not just the one that started the run — can stop it.
 */
export interface ActiveExperimentRun {
  experimentFileName: string;
  experimentName: string;
  progress: RunProgress;
  cancel(): void;
}

interface ExperimentRunState {
  active: ActiveExperimentRun | null;
  lastSummary: RunSummary | null;
  lastError: string | null;

  start(run: { experimentFileName: string; experimentName: string; cancel: () => void }): void;
  updateProgress(progress: RunProgress): void;
  finish(summary: RunSummary | null, error?: string | null): void;
}

const IDLE_PROGRESS: RunProgress = { completed: 0, total: 0, failures: 0, currentPoint: -1 };

export const useExperimentRunStore = create<ExperimentRunState>((set) => ({
  active: null,
  lastSummary: null,
  lastError: null,

  start: ({ experimentFileName, experimentName, cancel }) =>
    set({
      active: { experimentFileName, experimentName, cancel, progress: IDLE_PROGRESS },
      lastSummary: null,
      lastError: null,
    }),

  updateProgress: (progress) =>
    set((s) => (s.active ? { active: { ...s.active, progress } } : s)),

  finish: (summary, error = null) => set({ active: null, lastSummary: summary, lastError: error }),
}));
