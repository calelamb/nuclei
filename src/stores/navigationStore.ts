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

export type SettingsSectionId = 'appearance' | 'workspace' | 'editor' | 'dirac' | 'help';
export interface SettingsTarget { section: SettingsSectionId; nonce: number }
const SETTINGS_SECTIONS: readonly string[] = ['appearance', 'workspace', 'editor', 'dirac', 'help'];
const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'dirac';

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
  /** Select a view after a workspace switch without re-opening a sidebar that is
   * folded away for a narrow window: it is parked and restored on grow instead. */
  setViewKeepingViewport: (view: NavView, canCollapse: boolean) => void;
  /** Section the Settings panel should expand, scroll to and focus on its next render. */
  settingsTarget: SettingsTarget | null;
  clearSettingsTarget: () => void;
  /** Open the Settings view, optionally at a section. Never closes a lesson or challenge. The only caller today is the
   * Dirac panel (its gear / "Open Settings" CTA, which passes a click event, not a
   * section), so the default lands on the Dirac AI section where the API key lives. */
  openSettings: (section?: unknown) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
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
  setViewKeepingViewport: (view, canCollapse) => {
    if (get().lastNarrow === true && canCollapse) {
      set({ activeView: null, autoCollapsedView: view });
      return;
    }
    get().setActiveView(view);
  },
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
  settingsTarget: null,
  clearSettingsTarget: () => set({ settingsTarget: null }),
  openSettings: (section) => {
    // Settings opens in the sidebar BESIDE a Learn/Challenge surface (PanelLayout shows it there),
    // so a student reaching for the API key keeps their lesson on screen.
    const keepsFullView = useLearnStore.getState().isLearnMode || useChallengeModeStore.getState().isChallengeMode;
    if (!keepsFullView) leaveFullViewSurfaces();
    const id = typeof section === 'string' && SETTINGS_SECTIONS.includes(section)
      ? (section as SettingsSectionId)
      : DEFAULT_SETTINGS_SECTION;
    set((s) => ({
      activeView: 'settings',
      autoCollapsedView: null,
      settingsTarget: { section: id, nonce: (s.settingsTarget?.nonce ?? 0) + 1 },
    }));
  },
}));
