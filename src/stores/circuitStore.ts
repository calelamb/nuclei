import { create } from 'zustand';
import type { CircuitSnapshot } from '../types/quantum';

export interface GateHighlight {
  gateIndex: number;
  style: 'pulse' | 'glow' | 'outline';
  expiresAt?: number; // timestamp, 0 = persistent
}

interface CircuitState {
  snapshot: CircuitSnapshot | null;
  isLoading: boolean;
  error: string | null;
  // Highlighting
  highlights: GateHighlight[];
  // Step-through mode
  stepMode: boolean;
  stepIndex: number; // gates up to this index rendered normally, rest grayed
  // Gate explorer
  explorerGateIndex: number | null;
  // Actions
  setSnapshot: (snapshot: CircuitSnapshot | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
  // Highlight actions
  addHighlight: (h: GateHighlight) => void;
  clearHighlights: () => void;
  // Step-through actions
  setStepMode: (on: boolean) => void;
  setStepIndex: (index: number) => void;
  stepNext: () => void;
  stepPrev: () => void;
  // Gate explorer
  setExplorerGateIndex: (index: number | null) => void;
}

export const useCircuitStore = create<CircuitState>((set, get) => ({
  snapshot: null,
  isLoading: false,
  error: null,
  highlights: [],
  stepMode: false,
  stepIndex: -1,
  explorerGateIndex: null,

  setSnapshot: (snapshot) =>
    set({
      snapshot,
      isLoading: false,
      error: null,
      highlights: [],
      stepMode: false,
      stepIndex: -1,
      explorerGateIndex: null,
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  clear: () => set({
    snapshot: null,
    error: null,
    highlights: [],
    stepMode: false,
    stepIndex: -1,
    explorerGateIndex: null,
  }),

  addHighlight: (h) => set((s) => ({ highlights: [...s.highlights, h] })),
  clearHighlights: () => set({ highlights: [] }),

  setStepMode: (on) => set({ stepMode: on, stepIndex: on ? 0 : -1 }),
  setStepIndex: (stepIndex) => set({ stepIndex }),
  stepNext: () => {
    const { stepIndex, snapshot } = get();
    if (snapshot && stepIndex < snapshot.gates.length - 1) {
      set({ stepIndex: stepIndex + 1 });
    }
  },
  stepPrev: () => {
    const { stepIndex } = get();
    if (stepIndex > 0) set({ stepIndex: stepIndex - 1 });
  },

  setExplorerGateIndex: (explorerGateIndex) => set({ explorerGateIndex }),
}));
