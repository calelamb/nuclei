import { useEffect, useRef } from 'react';
import type { PlatformBridge } from '../platform/bridge';
import type { WorkspaceMode } from '../stores/workspaceStore';
import { useNavigationStore } from '../stores/navigationStore';
import { useLearnStore } from '../stores/learnStore';
import { useChallengeModeStore } from '../stores/challengeModeStore';
import { useDiracPanelStore } from '../stores/diracPanelStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { bandsForWidth } from '../layout/breakpoints';
import { parseShell, sameShell, shellStorageKey, type PersistedShell } from '../layout/shellPersistence';

const PERSIST_DEBOUNCE_MS = 500;

function currentTakeover(): PersistedShell['takeover'] {
  if (useChallengeModeStore.getState().isChallengeMode) return 'challenges';
  if (useLearnStore.getState().isLearnMode) return 'learning';
  return null;
}

/** The user's intent, not the transient auto-collapsed state. */
function currentShell(): PersistedShell {
  const nav = useNavigationStore.getState();
  const dirac = useDiracPanelStore.getState();
  const bottom = useBottomPanelStore.getState();
  return {
    activeView: nav.autoCollapsedView ?? nav.activeView,
    takeover: currentTakeover(),
    diracOpen: dirac.isOpen || dirac.autoCollapsed,
    diracWidth: dirac.width,
    bottomCollapsed: bottom.collapsed,
    bottomTab: bottom.activeTab,
  };
}

function applyViewport(canCollapseSidebar: () => boolean): void {
  if (typeof window === 'undefined') return;
  const bands = bandsForWidth(window.innerWidth);
  useDiracPanelStore.getState().applyNarrow(bands.diracNarrow);
  useNavigationStore.getState().applyNarrow(bands.sidebarNarrow, canCollapseSidebar());
}

interface ShellLayoutOptions {
  platform: Pick<PlatformBridge, 'getStoredValue' | 'setStoredValue'>;
  mode: WorkspaceMode;
  /** Rail views the current mode offers (stored views outside this set are ignored). */
  validViews: readonly string[];
  /** False while a full-width takeover view is showing (collapsing the sidebar would drop it). */
  canCollapseSidebar: boolean;
}

/**
 * Shell chrome behaviour in one place:
 *  - responsive: Dirac folds to its rail tab below ~1400px and the sidebar
 *    below ~1000px, both restored when the window grows again;
 *  - persistence: sidebar view, Dirac open/width and the bottom panel survive a
 *    reload, per workspace mode.
 */
export function useShellLayout({ platform, mode, validViews, canCollapseSidebar }: ShellLayoutOptions): void {
  const canCollapseRef = useRef(canCollapseSidebar);
  const validViewsRef = useRef(validViews);
  useEffect(() => {
    canCollapseRef.current = canCollapseSidebar;
    validViewsRef.current = validViews;
  });
  const loadedKeyRef = useRef<string | null>(null);
  const lastSavedRef = useRef<PersistedShell | null>(null);

  // Hydrate when the workspace mode (and so the storage key) changes.
  useEffect(() => {
    const key = shellStorageKey(mode);
    let cancelled = false;
    (async () => {
      try {
        const raw = await platform.getStoredValue<unknown>(key);
        if (cancelled) return;
        const saved = parseShell(raw, validViewsRef.current);
        if ('activeView' in saved) useNavigationStore.setState({ activeView: saved.activeView ?? null, autoCollapsedView: null, lastNarrow: null });
        // A lesson or challenge owns the area (activeView is null under it): reopen it, not a bare sidebar.
        if (saved.takeover) useNavigationStore.getState().selectView(saved.takeover, { toggle: false });
        useDiracPanelStore.getState().hydrate({ isOpen: saved.diracOpen, width: saved.diracWidth ?? undefined });
        if (saved.bottomCollapsed !== undefined) useBottomPanelStore.getState().setCollapsed(saved.bottomCollapsed);
        if (saved.bottomTab) useBottomPanelStore.getState().setActiveTab(saved.bottomTab);
      } catch {
        /* non-critical layout persistence */
      } finally {
        if (!cancelled) {
          loadedKeyRef.current = key;
          lastSavedRef.current = currentShell();
          applyViewport(() => canCollapseRef.current);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, mode]);

  // Persist (debounced) whenever the chrome changes, once hydrated.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const key = shellStorageKey(mode);
    const save = () => {
      timer = null;
      const next = currentShell();
      if (lastSavedRef.current && sameShell(lastSavedRef.current, next)) return;
      lastSavedRef.current = next;
      platform.setStoredValue(key, next).catch(() => {
        /* non-critical layout persistence */
      });
    };
    const schedule = () => {
      if (loadedKeyRef.current !== key) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, PERSIST_DEBOUNCE_MS);
    };
    const unsubs = [
      useNavigationStore.subscribe(schedule),
      useDiracPanelStore.subscribe(schedule),
      useBottomPanelStore.subscribe(schedule),
      useLearnStore.subscribe(schedule),
      useChallengeModeStore.subscribe(schedule),
    ];
    return () => {
      // A mode switch must not drop the last change made in the mode being left.
      if (timer) {
        clearTimeout(timer);
        if (loadedKeyRef.current === key) save();
      }
      unsubs.forEach((u) => u());
    };
  }, [platform, mode]);

  // Responsive collapse.
  useEffect(() => {
    const onResize = () => applyViewport(() => canCollapseRef.current);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
}
