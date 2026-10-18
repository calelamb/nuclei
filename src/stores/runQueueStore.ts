import { create } from 'zustand';

interface RunQueueState {
  /** A run was requested while the kernel was still starting; it fires the moment the kernel is ready. */
  queued: boolean;
  setQueued: (queued: boolean) => void;
}

/**
 * Shared view of the "run waiting for the kernel" flag, so the toolbar's Run slot can show it (and cancel it)
 * instead of only the Terminal saying so. useKernel owns the actual deferred run and follows this flag.
 */
export const useRunQueueStore = create<RunQueueState>((set) => ({
  queued: false,
  setQueued: (queued) => set({ queued }),
}));
