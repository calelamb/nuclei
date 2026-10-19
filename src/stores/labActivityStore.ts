import { create } from 'zustand';

/**
 * Lightweight, always-loaded mirror of running Discovery Engine work. The
 * discovery store (lazy, heavy) publishes here; the status bar chip and the
 * mode-switch guard read here, so neither pulls the search engine into the
 * main bundle.
 */
export interface DiscoveryActivity {
  runId: string;
  name: string;
  status: 'running' | 'paused';
  evaluations: number;
  maxEvaluations: number;
}

interface LabActivityState {
  discovery: DiscoveryActivity | null;
  setDiscovery(activity: DiscoveryActivity | null): void;
}

export const useLabActivityStore = create<LabActivityState>((set, get) => ({
  discovery: null,
  setDiscovery(activity) {
    const current = get().discovery;
    const same =
      current === activity ||
      (current !== null &&
        activity !== null &&
        current.runId === activity.runId &&
        current.status === activity.status &&
        current.evaluations === activity.evaluations &&
        current.maxEvaluations === activity.maxEvaluations &&
        current.name === activity.name);
    if (!same) set({ discovery: activity });
  },
}));
