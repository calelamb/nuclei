import type { NavView } from '../stores/navigationStore';
import type { BottomPanelTab } from '../stores/bottomPanelStore';

/** The slice of shell chrome that survives a reload (per workspace mode). */
export type PersistedTakeover = 'learning' | 'challenges';

export interface PersistedShell {
  activeView: NavView | null;
  /** The full-width Learn/Challenge surface the person was in (a takeover clears activeView). */
  takeover: PersistedTakeover | null;
  diracOpen: boolean;
  diracWidth: number | null;
  bottomCollapsed: boolean;
  bottomTab: BottomPanelTab;
}

export function shellStorageKey(mode: string): string {
  return `layout_shell:${mode}`;
}

/**
 * Validate whatever came out of storage. Anything malformed or stale (a view
 * this mode no longer offers) is dropped field-by-field, never trusted.
 */
export function parseShell(raw: unknown, validViews: readonly string[]): Partial<PersistedShell> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PersistedShell> = {};
  if (r.activeView === null) out.activeView = null;
  else if (typeof r.activeView === 'string' && validViews.includes(r.activeView)) out.activeView = r.activeView as NavView;
  if (r.takeover === null) out.takeover = null;
  else if ((r.takeover === 'learning' || r.takeover === 'challenges') && validViews.includes(r.takeover)) out.takeover = r.takeover;
  if (typeof r.diracOpen === 'boolean') out.diracOpen = r.diracOpen;
  if (typeof r.diracWidth === 'number' && Number.isFinite(r.diracWidth)) out.diracWidth = r.diracWidth;
  if (typeof r.bottomCollapsed === 'boolean') out.bottomCollapsed = r.bottomCollapsed;
  if (r.bottomTab === 'terminal' || r.bottomTab === 'histogram') out.bottomTab = r.bottomTab;
  return out;
}

export function sameShell(a: PersistedShell, b: PersistedShell): boolean {
  return (
    a.activeView === b.activeView &&
    a.takeover === b.takeover &&
    a.diracOpen === b.diracOpen &&
    a.diracWidth === b.diracWidth &&
    a.bottomCollapsed === b.bottomCollapsed &&
    a.bottomTab === b.bottomTab
  );
}
