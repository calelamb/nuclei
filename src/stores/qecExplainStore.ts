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
  /** Id of the in-flight request; replies bound to any other id are stale. */
  requestId: string | null;
  begin(forText: string, requestId?: string): void;
  /** A reply carrying a request id that is not the current one is ignored. */
  setResult(result: QecExplainData, requestId?: string | null): void;
  setError(error: string, requestId?: string | null): void;
  /** Connection lost / send failed: flag the pending request as failed. No-op when idle. */
  failPending(error: string): void;
  reset(): void;
}

const isStale = (current: string | null, incoming: string | null | undefined): boolean =>
  incoming != null && current !== incoming;

export const useQecExplainStore = create<QecExplainState>((set, get) => ({
  result: null,
  forText: null,
  pending: false,
  error: null,
  requestId: null,
  begin: (forText, requestId) =>
    set({ forText, pending: true, error: null, result: null, requestId: requestId ?? null }),
  setResult: (result, requestId) => {
    if (isStale(get().requestId, requestId)) return;
    set({ result, pending: false, error: null });
  },
  setError: (error, requestId) => {
    if (isStale(get().requestId, requestId)) return;
    set({ error, pending: false, result: null });
  },
  failPending: (error) => {
    if (get().pending) set({ error, pending: false, result: null });
  },
  reset: () => set({ result: null, forText: null, pending: false, error: null, requestId: null }),
}));
