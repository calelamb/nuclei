import { create } from 'zustand';
import type { DebugTrace } from '../types/quantum';

/**
 * Dev tools Phase 3 — Quantum Debugger state.
 *
 * Holds the per-gate state trajectory fetched once when the user enters
 * step-through mode. The existing `circuitStore` cursor (`stepIndex`) then
 * indexes into this trace client-side, so scrubbing shows the Bloch sphere +
 * probabilities at each step with no kernel round-trip per step.
 */
export interface DebugState {
  trace: DebugTrace | null;
  pending: boolean;
  error: string | null;
  setPending(pending: boolean): void;
  setTrace(trace: DebugTrace): void;
  setError(error: string): void;
  clear(): void;
}

export const useDebugStore = create<DebugState>((set) => ({
  trace: null,
  pending: false,
  error: null,
  setPending: (pending) => set((s) => ({ pending, error: pending ? null : s.error })),
  setTrace: (trace) => set({ trace, pending: false, error: null }),
  setError: (error) => set({ error, pending: false }),
  clear: () => set({ trace: null, pending: false, error: null }),
}));
