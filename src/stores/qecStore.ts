import { create } from 'zustand';
import type { QecSnapshot, QecDecodeSampleResult } from '../types/qec';

/**
 * PRD 10 Phase D — QEC visualization state.
 *
 * Holds the most recent `qec_snapshot` sidecar (coords + detector-error-model
 * graph) the kernel emits for a Stim circuit, plus the latest
 * `qec_decode_sample` overlay for the detector graph's "Sample a shot" action.
 *
 * The snapshot is cleared whenever a non-stim circuit is parsed/executed (the
 * QEC panels have framework affinity in the registry and won't render, but
 * clearing keeps stale data from flashing if the user swaps back). A pending
 * flag lets the "Sample a shot" button show progress without a global spinner.
 */
interface QecState {
  snapshot: QecSnapshot | null;
  decodeSample: QecDecodeSampleResult | null;
  decodePending: boolean;
  /** The .stim/py source that produced `snapshot`, needed to request a
   * decode sample for the exact same circuit. */
  circuitText: string | null;
  setSnapshot(snapshot: QecSnapshot | null, circuitText: string | null): void;
  clear(): void;
  setDecodePending(pending: boolean): void;
  setDecodeSample(sample: QecDecodeSampleResult | null): void;
  clearDecodeSample(): void;
}

export const useQecStore = create<QecState>((set) => ({
  snapshot: null,
  decodeSample: null,
  decodePending: false,
  circuitText: null,
  setSnapshot: (snapshot, circuitText) =>
    // A fresh circuit invalidates any prior decode overlay.
    set({ snapshot, circuitText, decodeSample: null, decodePending: false }),
  clear: () => set({ snapshot: null, circuitText: null, decodeSample: null, decodePending: false }),
  setDecodePending: (decodePending) => set({ decodePending }),
  setDecodeSample: (decodeSample) => set({ decodeSample, decodePending: false }),
  clearDecodeSample: () => set({ decodeSample: null }),
}));
