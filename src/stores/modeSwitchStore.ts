import { create } from 'zustand';
import { useWorkspaceStore, type WorkspaceMode } from './workspaceStore';
import { useExperimentRunStore } from './experimentRunStore';

/**
 * PRD 11 Phase B — workspace mode switching with an in-flight-work guard.
 *
 * Switching modes NEVER cancels jobs (visibility ≠ lifecycle). But switching
 * away while a sweep/campaign is running would silently hide the Experiments
 * panel that shows it, so we confirm first — naming the running work. This
 * store is the single orchestration point so the mode chip AND the command
 * palette route through the same guard, and a single dialog + aria-live
 * announcer render once at the layout root.
 */

interface PendingSwitch {
  target: WorkspaceMode;
  /** Name of the running experiment/campaign, for the confirm copy. */
  runningName: string;
}

interface ModeSwitchState {
  pending: PendingSwitch | null;
  /** Polite live-region text; updated on every completed mode change. */
  announcement: string;
  /**
   * Ask to switch to `target`. Immediate + announced when nothing is running
   * (or the target equals the current mode); otherwise stages a confirm.
   */
  requestSwitch(target: WorkspaceMode): void;
  /** Toggle helper — the command palette's blind "Switch workspace mode". */
  requestToggle(): void;
  /** Apply the staged switch (user confirmed). */
  confirmPending(): void;
  /** Discard the staged switch. */
  cancelPending(): void;
}

function announce(mode: WorkspaceMode): string {
  return mode === 'research' ? 'Switched to Research mode' : 'Switched to Learn mode';
}

function applySwitch(target: WorkspaceMode, set: (partial: Partial<ModeSwitchState>) => void): void {
  useWorkspaceStore.getState().setMode(target);
  set({ pending: null, announcement: announce(target) });
}

export const useModeSwitchStore = create<ModeSwitchState>((set, get) => ({
  pending: null,
  announcement: '',

  requestSwitch: (target) => {
    const current = useWorkspaceStore.getState().mode;
    if (target === current) {
      set({ pending: null });
      return;
    }
    // A running sweep/campaign is only *shown* in Research mode's Experiments
    // panel, so switching while one runs would hide it — confirm and name it.
    const activeRun = useExperimentRunStore.getState().active;
    if (activeRun) {
      set({ pending: { target, runningName: activeRun.experimentName } });
      return;
    }
    applySwitch(target, set);
  },

  requestToggle: () => {
    const current = useWorkspaceStore.getState().mode;
    get().requestSwitch(current === 'learn' ? 'research' : 'learn');
  },

  confirmPending: () => {
    const pending = get().pending;
    if (!pending) return;
    applySwitch(pending.target, set);
  },

  cancelPending: () => set({ pending: null }),
}));
