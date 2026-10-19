import { create } from 'zustand';
import { useWorkspaceStore, type WorkspaceMode } from './workspaceStore';
import { useExperimentRunStore } from './experimentRunStore';
import { useLearnStore } from './learnStore';
import { useChallengeModeStore } from './challengeModeStore';
import { canEnterMode, isLearnEnabled, useLearnGateStore } from './learnGateStore';
import { focusAfterUnmount } from '../hooks/focusAfterUnmount';

/** The status bar's workspace chip: the one control present in every mode, so focus can always come home to it. */
export const MODE_CHIP_FOCUS_ID = 'mode-chip';

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
  /**
   * Turn the Learning workspace on or off (Settings switch). Turning it off
   * while in Learn lands in Research straight away, with focus kept on the
   * mode chip's successor, and closes any open lesson/challenge takeover.
   * Stored Learn progress and remembered modes are left alone.
   */
  setLearnEnabled(enabled: boolean): void;
  /** Apply the staged switch (user confirmed). */
  confirmPending(): void;
  /** Discard the staged switch. */
  cancelPending(): void;
}

function announce(mode: WorkspaceMode): string {
  return mode === 'research' ? 'Switched to Research mode' : 'Switched to Learn mode';
}

function applySwitch(target: WorkspaceMode, set: (partial: Partial<ModeSwitchState>) => void): void {
  // Mode-specific chrome (the Level chip, a Learn-only panel) unmounts with the switch; keep focus on something real.
  if (typeof document !== 'undefined') focusAfterUnmount(document.activeElement, [`[data-focus-id="${MODE_CHIP_FOCUS_ID}"]`]);
  useWorkspaceStore.getState().setMode(target);
  set({ pending: null, announcement: announce(target) });
}

export const useModeSwitchStore = create<ModeSwitchState>((set, get) => ({
  pending: null,
  announcement: '',

  requestSwitch: (target) => {
    // Learn is hidden unless the gate is on: refuse, and drop any staged switch into it.
    if (!canEnterMode(target, isLearnEnabled())) {
      set({ pending: null });
      return;
    }
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
    // Research is the only mode while the gate is off, so there is nothing to toggle to.
    if (!isLearnEnabled()) return;
    const current = useWorkspaceStore.getState().mode;
    get().requestSwitch(current === 'learn' ? 'research' : 'learn');
  },

  setLearnEnabled: (enabled) => {
    const wasLearn = useWorkspaceStore.getState().mode === 'learn';
    if (!enabled && wasLearn) {
      // Learn-only chrome unmounts with the gate; keep focus on something real (same rule as applySwitch).
      if (typeof document !== 'undefined') focusAfterUnmount(document.activeElement, [`[data-focus-id="${MODE_CHIP_FOCUS_ID}"]`]);
      useLearnStore.getState().exitLearnMode();
      useChallengeModeStore.getState().exitChallengeMode();
    }
    // workspaceStore re-derives the mode from this flip (off forces Research without rewriting stored modes).
    useLearnGateStore.getState().setLearnEnabled(enabled);
    set({ pending: null, ...(!enabled && wasLearn ? { announcement: announce('research') } : {}) });
  },

  confirmPending: () => {
    const pending = get().pending;
    if (!pending) return;
    if (!canEnterMode(pending.target, isLearnEnabled())) {
      set({ pending: null });
      return;
    }
    applySwitch(pending.target, set);
  },

  cancelPending: () => set({ pending: null }),
}));
