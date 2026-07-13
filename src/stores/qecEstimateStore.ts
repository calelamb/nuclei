import { create } from 'zustand';
import type { QecEstimate, QecEstimateOptions } from '../types/qec';

/**
 * PRD 10 Phase F — Resource Estimator panel state. Holds the last estimate,
 * a pending flag while the kernel computes, and the chosen options. Estimation
 * can take a few seconds; the panel shows progress without a global spinner.
 */
interface QecEstimateState {
  result: QecEstimate | null;
  pending: boolean;
  error: string | null;
  options: QecEstimateOptions;
  setPending(pending: boolean): void;
  setResult(result: QecEstimate): void;
  setError(error: string): void;
  setOptions(options: QecEstimateOptions): void;
  reset(): void;
}

export const useQecEstimateStore = create<QecEstimateState>((set) => ({
  result: null,
  pending: false,
  error: null,
  options: { qubit_params: 'qubit_gate_ns_e3', qec_scheme: 'surface_code', error_budget: 0.001 },
  setPending: (pending) => set({ pending, error: pending ? null : undefined }),
  setResult: (result) => set({ result, pending: false, error: null }),
  setError: (error) => set({ error, pending: false }),
  setOptions: (options) => set((s) => ({ options: { ...s.options, ...options } })),
  reset: () => set({ result: null, pending: false, error: null }),
}));
