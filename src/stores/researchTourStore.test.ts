import { describe, it, expect, beforeEach } from 'vitest';

// Node vitest env has no localStorage; the tour store reads/writes it (guarded
// by try/catch). Install a minimal in-memory stand-in BEFORE importing the
// store so its initial `seen` is computed against it — same pattern as
// workspaceStore.test.ts / settingsStore.test.ts.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import { useResearchTourStore, RESEARCH_TOUR_STEP_COUNT } from './researchTourStore';

const SEEN_KEY = 'nuclei:research_tour_seen';

describe('researchTourStore (PRD 11 Phase B)', () => {
  beforeEach(() => {
    localStorage.clear();
    useResearchTourStore.setState({ seen: false, active: false, step: 0 });
  });

  it('maybeAutoStart shows the tour once when never seen', () => {
    useResearchTourStore.getState().maybeAutoStart();
    expect(useResearchTourStore.getState().active).toBe(true);
    expect(useResearchTourStore.getState().step).toBe(0);
  });

  it('maybeAutoStart is a no-op once seen', () => {
    useResearchTourStore.setState({ seen: true });
    useResearchTourStore.getState().maybeAutoStart();
    expect(useResearchTourStore.getState().active).toBe(false);
  });

  it('maybeAutoStart is a no-op if already active', () => {
    useResearchTourStore.setState({ active: true, step: 1 });
    useResearchTourStore.getState().maybeAutoStart();
    expect(useResearchTourStore.getState().step).toBe(1); // not reset
  });

  it('next advances, and completing marks seen-forever + persists', () => {
    useResearchTourStore.getState().start();
    for (let i = 0; i < RESEARCH_TOUR_STEP_COUNT - 1; i += 1) {
      useResearchTourStore.getState().next();
      expect(useResearchTourStore.getState().active).toBe(true);
    }
    // Final next completes the tour.
    useResearchTourStore.getState().next();
    expect(useResearchTourStore.getState().active).toBe(false);
    expect(useResearchTourStore.getState().seen).toBe(true);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('prev goes back but never below 0', () => {
    useResearchTourStore.getState().start();
    useResearchTourStore.getState().next();
    expect(useResearchTourStore.getState().step).toBe(1);
    useResearchTourStore.getState().prev();
    expect(useResearchTourStore.getState().step).toBe(0);
    useResearchTourStore.getState().prev();
    expect(useResearchTourStore.getState().step).toBe(0);
  });

  it('dismiss ends the tour and marks it seen-forever', () => {
    useResearchTourStore.getState().start();
    useResearchTourStore.getState().dismiss();
    expect(useResearchTourStore.getState().active).toBe(false);
    expect(useResearchTourStore.getState().seen).toBe(true);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1');
    // A subsequent auto-start attempt is now inert.
    useResearchTourStore.getState().maybeAutoStart();
    expect(useResearchTourStore.getState().active).toBe(false);
  });

  it('start replays the tour even after it was seen', () => {
    useResearchTourStore.setState({ seen: true });
    useResearchTourStore.getState().start();
    expect(useResearchTourStore.getState().active).toBe(true);
    expect(useResearchTourStore.getState().step).toBe(0);
  });
});
