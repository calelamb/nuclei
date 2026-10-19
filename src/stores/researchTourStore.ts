import { create } from 'zustand';
import { useWorkspaceStore } from './workspaceStore';

/**
 * PRD 11 Phase B — first-run Research orientation tour.
 *
 * A 3-step coach-mark shown once, the first time a user enters Research mode.
 * `seen` persists (localStorage) so it never auto-repeats (Risk 4: tour
 * fatigue). `start()` ignores `seen` so the command palette's "Research mode
 * tour" can always replay it.
 */

const SEEN_KEY = 'nuclei:research_tour_seen';
export const RESEARCH_TOUR_STEP_COUNT = 3;

function loadSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function persistSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* restricted environment — non-critical */
  }
}

/** The tour describes Research surfaces, so it may only run while the workspace is in Research. */
function inResearch(): boolean {
  return useWorkspaceStore.getState().mode === 'research';
}

interface ResearchTourState {
  seen: boolean;
  active: boolean;
  step: number;
  /** Begin the tour from step 0 (replayable — ignores `seen`). */
  start(): void;
  next(): void;
  prev(): void;
  /** End the tour and mark it seen-forever. */
  dismiss(): void;
  /** End the tour without marking it seen (the mode left Research, or another modal took over). */
  stop(): void;
  /** Auto-start once, on first Research entry, if never seen. No-op otherwise. */
  maybeAutoStart(): void;
}

export const useResearchTourStore = create<ResearchTourState>((set, get) => ({
  seen: loadSeen(),
  active: false,
  step: 0,

  start: () => {
    if (!inResearch()) return;
    set({ active: true, step: 0 });
  },

  stop: () => set({ active: false, step: 0 }),

  next: () =>
    set((s) => {
      const next = s.step + 1;
      if (next >= RESEARCH_TOUR_STEP_COUNT) {
        persistSeen();
        return { active: false, step: 0, seen: true };
      }
      return { step: next };
    }),

  prev: () => set((s) => ({ step: Math.max(0, s.step - 1) })),

  dismiss: () => {
    persistSeen();
    set({ active: false, step: 0, seen: true });
  },

  maybeAutoStart: () => {
    const { seen, active } = get();
    if (seen || active || !inResearch()) return;
    set({ active: true, step: 0 });
  },
}));
