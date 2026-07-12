import { create } from 'zustand';

/**
 * PRD 09, Phase A — Learn/Research workspace mode.
 *
 * This store is DELIBERATELY separate from `uiModeStore` (beginner /
 * intermediate / advanced), which governs progressive disclosure *within*
 * Learn mode. Research mode ignores `uiModeStore` entirely — Research is
 * always "advanced". Do not fork or read `uiModeStore` from here.
 */
export type WorkspaceMode = 'learn' | 'research';

interface WorkspaceState {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
}

const GLOBAL_KEY = 'nuclei:workspace_mode';
const PROJECT_KEY = 'nuclei:workspace_mode_by_project';

function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === 'learn' || value === 'research';
}

function loadGlobalMode(): WorkspaceMode {
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    return isWorkspaceMode(raw) ? raw : 'learn';
  } catch {
    return 'learn';
  }
}

function persistGlobalMode(mode: WorkspaceMode): void {
  try {
    localStorage.setItem(GLOBAL_KEY, mode);
  } catch {
    /* restricted environment (e.g. private browsing) — non-critical */
  }
}

function loadProjectModes(): Record<string, WorkspaceMode> {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, WorkspaceMode> = {};
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isWorkspaceMode(value)) result[path] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function persistProjectModes(modes: Record<string, WorkspaceMode>): void {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(modes));
  } catch {
    /* restricted environment — non-critical */
  }
}

// Tracks the currently-open project so `setMode` knows whether to write a
// per-project entry or the global default. Module-level (not store state)
// because it mirrors projectStore's own root — projectStore is the single
// source of truth for "which project is open"; we just cache the value it
// pushes us via __notifyProjectRootChanged.
let currentProjectRoot: string | null = null;

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  mode: loadGlobalMode(),

  setMode: (mode) => {
    set({ mode });
    if (currentProjectRoot) {
      // A project is open: this mode choice is specific to that project.
      // The global default (what a brand-new project starts as) is left
      // alone — flipping one project to Research shouldn't silently make
      // every future new project open in Research too.
      const modes = loadProjectModes();
      persistProjectModes({ ...modes, [currentProjectRoot]: mode });
    } else {
      // No project open (first-launch chooser, or between projects): this
      // is exactly what "the global default" means, so update it.
      persistGlobalMode(mode);
    }
  },
}));

/**
 * Called by `projectStore.setProjectRoot` whenever the open project
 * changes (including closing to `null`). Adopts the newly-opened project's
 * remembered mode if one was recorded, otherwise falls back to the global
 * default.
 *
 * Kept as a plain exported function (mirroring diracStore's
 * `__setProjectRootGetter` pattern) rather than an import of projectStore,
 * so projectStore -> workspaceStore stays a one-directional dependency and
 * we never introduce projectStore <-> workspaceStore circularity.
 */
export function __notifyProjectRootChanged(root: string | null): void {
  currentProjectRoot = root;
  const modes = loadProjectModes();
  const remembered = root !== null ? modes[root] : undefined;
  useWorkspaceStore.setState({ mode: remembered ?? loadGlobalMode() });
}
