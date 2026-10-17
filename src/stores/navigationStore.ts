import { create } from 'zustand';
import type { LeftPanelId } from '../layout/panelRegistry';
import { useLearnStore } from './learnStore';
import { useChallengeModeStore } from './challengeModeStore';

/**
 * Selecting a concrete rail view leaves any Learn/Challenge full-view surface
 * (their sidebars are hidden, so a view selection must exit them to be
 * visible). Done here, at the action, rather than in a PanelLayout effect that
 * watches `activeView` — an effect would race the enter-Learn-mode transition
 * and could bounce the user straight back out. Idempotent: exit is a no-op
 * when the mode isn't active. Never fires for a `null` (collapse) target, so
 * entering Learn mode (which sets `activeView` to null) is unaffected.
 */
function leaveFullViewSurfaces(): void {
  const learn = useLearnStore.getState();
  if (learn.isLearnMode) learn.exitLearnMode();
  const challenge = useChallengeModeStore.getState();
  if (challenge.isChallengeMode) challenge.exitChallengeMode();
}

/**
 * The workspace navigation store — the single source of truth for which
 * activity-bar view is open in the left rail. Lifted out of `PanelLayout`'s
 * local `useState` (PRD 11 Phase D) so the command palette, keyboard
 * shortcuts (⌘1..9), the Dirac panel's Settings gear, and breadcrumbs can all
 * drive and read navigation without prop-drilling or the old increment-a-
 * signal hack. `activeView === null` means the sidebar is collapsed.
 *
 * The view id union is `LeftPanelId` from the panel registry, which is
 * asserted structurally identical to the ActivityBar's `ActivityView`.
 */
export type NavView = LeftPanelId;

interface NavigationState {
  activeView: NavView | null;
  /** Set (or clear, with null) the open rail view. */
  setActiveView: (view: NavView | null) => void;
  /** Click-through toggle: selecting the already-open view collapses it. */
  toggleView: (view: NavView) => void;
  /** The view the sidebar was showing before it auto-collapsed for a narrow window. */
  autoCollapsedView: NavView | null;
  /** Last viewport band seen by `applyNarrow` (null before the first call). */
  lastNarrow: boolean | null;
  /** Collapse the sidebar when narrow and restore it on grow. `canCollapse` is false
   * while a full-width takeover view is showing (collapsing it would drop the view). */
  applyNarrow: (narrow: boolean, canCollapse: boolean) => void;
  /** Open the Settings view (the Dirac panel's gear; formerly `openSettings`
   * via `settingsSignal`). PanelLayout's mode-exit effect handles leaving any
   * Learn/Challenge full-view surface. */
  openSettings: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeView: 'files',
  autoCollapsedView: null,
  lastNarrow: null,
  // Any explicit selection cancels a pending automatic restore.
  setActiveView: (view) => {
    if (view !== null) leaveFullViewSurfaces();
    set({ activeView: view, autoCollapsedView: null });
  },
  toggleView: (view) =>
    set((s) => {
      const next = s.activeView === view ? null : view;
      if (next !== null) leaveFullViewSurfaces();
      return { activeView: next, autoCollapsedView: null };
    }),
  applyNarrow: (narrow, canCollapse) =>
    set((s) => {
      if (s.lastNarrow === narrow) return s;
      if (narrow) {
        return canCollapse && s.activeView !== null
          ? { lastNarrow: narrow, activeView: null, autoCollapsedView: s.activeView }
          : { lastNarrow: narrow };
      }
      return s.autoCollapsedView !== null && s.activeView === null
        ? { lastNarrow: narrow, activeView: s.autoCollapsedView, autoCollapsedView: null }
        : { lastNarrow: narrow, autoCollapsedView: null };
    }),
  openSettings: () => {
    leaveFullViewSurfaces();
    set({ activeView: 'settings', autoCollapsedView: null });
  },
}));
