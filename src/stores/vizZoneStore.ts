import { create } from 'zustand';
import type { PanelId } from '../layout/panelRegistry';

/**
 * PRD 10 Phase D (viz-zone tabbed overflow, pulled forward from PRD 11 E).
 *
 * When more than two viz panels are visible, the right rail becomes a tabbed
 * group. The active tab is remembered per project, so a researcher's chosen
 * arrangement survives reopening the project. Persisted to localStorage
 * (small, synchronous — same pattern as workspaceStore).
 */
const KEY = 'nuclei:viz_active_tab_by_project';

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* restricted environment — non-critical */
  }
}

interface VizZoneState {
  activeTabByProject: Record<string, string>;
  /** Remember the active viz tab for a project (null root = shared bucket). */
  setActiveTab(projectRoot: string | null, id: PanelId): void;
  /** The remembered tab for a project, or null if none. */
  activeTabFor(projectRoot: string | null): string | null;
}

export const useVizZoneStore = create<VizZoneState>((set, get) => ({
  activeTabByProject: load(),
  setActiveTab: (projectRoot, id) =>
    set((state) => {
      const next = { ...state.activeTabByProject, [projectRoot ?? '__global__']: id };
      persist(next);
      return { activeTabByProject: next };
    }),
  activeTabFor: (projectRoot) => get().activeTabByProject[projectRoot ?? '__global__'] ?? null,
}));
