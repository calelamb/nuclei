import { create } from 'zustand';

/**
 * PRD 09 Phase D — Research-mode Experiments UI selection state.
 *
 * Purely a "what is the user looking at" store: which experiment (by yaml
 * filename) is selected in the Experiments panel, and which run (by run
 * directory basename) is selected within that experiment's runs table.
 * `PanelLayout` reads this to decide whether to swap its main content area
 * for `RunsTable` / `RunDetail`. No file or kernel I/O here.
 */
interface ExperimentUiState {
  selectedExperimentFileName: string | null;
  selectedRunDir: string | null;
  selectExperiment(fileName: string | null): void;
  selectRun(dir: string | null): void;
}

export const useExperimentUiStore = create<ExperimentUiState>((set) => ({
  selectedExperimentFileName: null,
  selectedRunDir: null,

  // Picking a (possibly different) experiment always drops any selected run
  // from the previous experiment — a stale run-detail view for the wrong
  // experiment would be a confusing dead end.
  selectExperiment: (fileName) =>
    set({ selectedExperimentFileName: fileName, selectedRunDir: null }),

  selectRun: (dir) => set({ selectedRunDir: dir }),
}));
