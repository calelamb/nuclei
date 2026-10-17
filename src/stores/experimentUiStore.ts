import { create } from 'zustand';

/**
 * PRD 09 Phase D — Research-mode Experiments UI selection state.
 *
 * Purely a "what is the user looking at" store: which experiment (by yaml
 * filename) is selected in the Experiments panel, and which run (by run
 * directory basename) is selected within that experiment's runs table.
 * `PanelLayout` reads this to decide whether to swap its main content area
 * for `RunsTable` / `RunDetail`. No file or kernel I/O here.
 *
 * PRD 09 Phase E adds `compareSelection` — the set of run dirs checked in
 * `RunsTable` for the Compare view — and `compareOpen`, which tells
 * `PanelLayout` to swap in `CompareView` instead. Kept as a separate,
 * additive concept from `selectedRunDir` (single-run detail) rather than
 * folding them together: a user can have both a run open in detail AND a
 * multi-run comparison selection pending at the same time.
 */
export type RunsMainTab = 'runs' | 'sweep';

/** Per-experiment runs-table view state, kept so returning from run detail or
 * compare restores exactly what the user was looking at. */
export interface RunsViewState {
  mainTab: RunsMainTab;
  statusFilter: string;
  sortKey: string | null;
  sortDirection: 'asc' | 'desc';
  scrollTop: number;
}

export const DEFAULT_RUNS_VIEW: RunsViewState = {
  mainTab: 'runs',
  statusFilter: 'all',
  sortKey: null,
  sortDirection: 'asc',
  scrollTop: 0,
};

interface ExperimentUiState {
  selectedExperimentFileName: string | null;
  selectedRunDir: string | null;
  /** Run dirs checked for comparison, in the order they were checked (so
   * series colors/legend order stay stable as the selection changes). */
  compareSelection: string[];
  /** Whether `CompareView` is showing instead of `RunsTable` / `RunDetail`. */
  compareOpen: boolean;
  runsViewByExperiment: Record<string, RunsViewState>;

  patchRunsView(fileName: string, patch: Partial<RunsViewState>): void;
  selectExperiment(fileName: string | null): void;
  selectRun(dir: string | null): void;
  toggleCompareSelection(dir: string): void;
  clearCompareSelection(): void;
  openCompare(): void;
  closeCompare(): void;
}

export const useExperimentUiStore = create<ExperimentUiState>((set) => ({
  selectedExperimentFileName: null,
  selectedRunDir: null,
  compareSelection: [],
  compareOpen: false,
  runsViewByExperiment: {},

  patchRunsView: (fileName, patch) =>
    set((s) => ({
      runsViewByExperiment: {
        ...s.runsViewByExperiment,
        [fileName]: { ...DEFAULT_RUNS_VIEW, ...s.runsViewByExperiment[fileName], ...patch },
      },
    })),

  // Picking a (possibly different) experiment always drops any selected run,
  // pending compare selection, and open compare view from the previous
  // experiment — a stale run-detail or comparison view for the wrong
  // experiment would be a confusing dead end.
  selectExperiment: (fileName) =>
    set({
      selectedExperimentFileName: fileName,
      selectedRunDir: null,
      compareSelection: [],
      compareOpen: false,
    }),

  selectRun: (dir) => set({ selectedRunDir: dir }),

  toggleCompareSelection: (dir) =>
    set((s) => ({
      compareSelection: s.compareSelection.includes(dir)
        ? s.compareSelection.filter((d) => d !== dir)
        : [...s.compareSelection, dir],
    })),

  clearCompareSelection: () => set({ compareSelection: [], compareOpen: false }),

  openCompare: () => set({ compareOpen: true }),
  closeCompare: () => set({ compareOpen: false }),
}));
