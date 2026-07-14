import { create } from 'zustand';

/**
 * Holds the framework a kernel `missing_dependency` error named, so the
 * MissingDependencyBanner can offer a one-click install instead of leaving
 * the student at a dead-end traceback. Populated from `useKernel`'s error
 * handler; cleared when installed or dismissed.
 */
interface MissingDependencyState {
  /** The dependency name the kernel reported (import/pip name), or null. */
  dependency: string | null;
  /** The framework label the kernel attributed the failure to, if any. */
  framework: string | null;
  report: (dependency: string, framework: string | null) => void;
  dismiss: () => void;
}

export const useMissingDependencyStore = create<MissingDependencyState>((set) => ({
  dependency: null,
  framework: null,
  report: (dependency, framework) => set({ dependency, framework }),
  dismiss: () => set({ dependency: null, framework: null }),
}));
