import { create } from 'zustand';
import type { CircuitSnapshot } from '../types/quantum';
import { useProjectStore } from './projectStore';

/** Stand-in key for the unsaved starter buffer (no project tab is open). */
export const BUFFER_KEY = '__buffer__';

function currentContextKey(): string {
  return useProjectStore.getState().activeTabPath ?? BUFFER_KEY;
}

export interface GateHighlight {
  gateIndex: number;
  style: 'pulse' | 'glow' | 'outline';
  expiresAt?: number; // timestamp, 0 = persistent
}

interface CircuitState {
  snapshot: CircuitSnapshot | null;
  /** Which tab the live snapshot belongs to (so a stale circuit is never shown for another file). */
  snapshotKey: string | null;
  /**
   * The last circuit with gates, kept when a transient parse error nulls `snapshot`. The viz
   * column keeps rendering it (dimmed) instead of unmounting while the user is mid-edit.
   */
  lastGood: { snapshot: CircuitSnapshot; key: string } | null;
  isLoading: boolean;
  error: string | null;
  /** The live preview was stopped for running too long; it is not a code error and Run still works. */
  previewPaused: boolean;
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
  setPreviewPaused: (paused: boolean) => void;
  /** Forget the latched last-good circuit (the code no longer parses *and* nothing explains why). */
  dropLastGood: () => void;
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
  snapshotKey: null,
  lastGood: null,
  isLoading: false,
  error: null,
  previewPaused: false,
  highlights: [],
  stepMode: false,
  stepIndex: -1,
  explorerGateIndex: null,

  setSnapshot: (snapshot) =>
    set((s) => {
      const nulling = snapshot === null;
      const latch = nulling && s.snapshot && s.snapshot.gates.length > 0 && s.snapshotKey
        ? { snapshot: s.snapshot, key: s.snapshotKey }
        : nulling ? s.lastGood : null;
      return {
        snapshot,
        snapshotKey: snapshot ? currentContextKey() : null,
        lastGood: latch,
        isLoading: false,
        error: null,
        previewPaused: false,
        highlights: [],
        stepMode: false,
        stepIndex: -1,
        explorerGateIndex: null,
      };
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false, previewPaused: false }),
  setPreviewPaused: (previewPaused) => set({ previewPaused, isLoading: false }),
  dropLastGood: () => set({ lastGood: null }),
  clear: () => set({
    snapshot: null,
    snapshotKey: null,
    lastGood: null,
    error: null,
    previewPaused: false,
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

export interface DisplaySnapshot {
  snapshot: CircuitSnapshot | null;
  /** True when this is the last good circuit shown while the current code does not parse. */
  stale: boolean;
}

/** What the viz column should draw for the given tab: the live snapshot, else the latched one for that same tab. */
export function selectDisplaySnapshot(state: Pick<CircuitState, 'snapshot' | 'lastGood'>, contextKey: string): DisplaySnapshot {
  if (state.snapshot) return { snapshot: state.snapshot, stale: false };
  if (state.lastGood && state.lastGood.key === contextKey) return { snapshot: state.lastGood.snapshot, stale: true };
  return { snapshot: null, stale: false };
}
