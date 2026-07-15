import { create } from 'zustand';
import type { TranspileResult } from '../types/quantum';

/**
 * Dev tools Phase 1 — Transpiler Explorer state.
 *
 * Holds the last transpile result plus the currently chosen target and
 * optimization level (the controls live in the sidebar, the before/after
 * visualization in the main area — both read this one store). `targetId`
 * identifies the selected device (`'simulator'` = all-to-all, no coupling
 * map / no basis constraint) or a hardware backend by name.
 */
export interface TranspileState {
  result: TranspileResult | null;
  pending: boolean;
  error: string | null;
  /** Selected target: 'simulator' (all-to-all) or a backend name. */
  targetId: string;
  optimizationLevel: 0 | 1 | 2 | 3;
  setTarget(targetId: string): void;
  setOptimizationLevel(level: 0 | 1 | 2 | 3): void;
  setPending(pending: boolean): void;
  setResult(result: TranspileResult): void;
  setError(error: string): void;
  reset(): void;
}

export const SIMULATOR_TARGET_ID = 'simulator';

export const useTranspileStore = create<TranspileState>((set) => ({
  result: null,
  pending: false,
  error: null,
  targetId: SIMULATOR_TARGET_ID,
  optimizationLevel: 1,
  // Changing the target/level invalidates the shown result so the panel never
  // pairs an old diagram with a new target label.
  setTarget: (targetId) => set({ targetId, result: null, error: null }),
  setOptimizationLevel: (optimizationLevel) => set({ optimizationLevel, result: null, error: null }),
  setPending: (pending) => set((s) => ({ pending, error: pending ? null : s.error })),
  setResult: (result) => set({ result, pending: false, error: null }),
  setError: (error) => set({ error, pending: false }),
  reset: () => set({ result: null, pending: false, error: null }),
}));
