import { create } from 'zustand';
import type { QecExplainData } from '../types/qecExplain';

/**
 * Circuit-explain state. A result is only ever valid for the exact circuit
 * text it was computed from (`forText`); the panel compares that to the live
 * editor buffer and withholds click-to-source when they differ.
 */
interface QecExplainState {
  result: QecExplainData | null;
  forText: string | null;
  pending: boolean;
  error: string | null;
  begin(forText: string): void;
  setResult(result: QecExplainData): void;
  setError(error: string): void;
  reset(): void;
}

export const useQecExplainStore = create<QecExplainState>((set) => ({
  result: null,
  forText: null,
  pending: false,
  error: null,
  begin: (forText) => set({ forText, pending: true, error: null, result: null }),
  setResult: (result) => set({ result, pending: false, error: null }),
  setError: (error) => set({ error, pending: false, result: null }),
  reset: () => set({ result: null, forText: null, pending: false, error: null }),
}));
