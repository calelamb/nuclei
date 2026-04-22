import { create } from 'zustand';
import {
  __setProjectRootGetter,
  loadDiracConversationForProject,
  useDiracStore,
} from './diracStore';

export interface ProjectTab {
  path: string;
  content: string;
  savedContent: string; // last-persisted content — dirty is derived from content !== savedContent
  isDirty: boolean;
}

interface ProjectState {
  projectRoot: string | null;
  tabs: ProjectTab[];
  activeTabPath: string | null;

  setProjectRoot(root: string | null): void;
  openTab(input: { path: string; content: string }): void;
  closeTab(path: string): void;
  setActiveTab(path: string): void;
  updateActiveTabContent(content: string): void;
  markTabSaved(path: string, savedContent: string): void;
  renameTab(oldPath: string, newPath: string): void;
  closeAllTabs(): void;
  hasAnyDirty(): boolean;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectRoot: null,
  tabs: [],
  activeTabPath: null,

  // Setting the project root doubles as the trigger for Dirac
  // conversation load/save. The diracStore subscribes to its own
  // `messages` changes for the auto-save (debounced 300ms), so the
  // outgoing project's latest state is already on disk before we flip
  // roots here — we only need to load the incoming project's file.
  setProjectRoot: (projectRoot) =>
    set((s) => {
      if (s.projectRoot === projectRoot) return s;
      // Load the new project's persisted conversation (or reset to empty
      // when closing a project — decision (a) from PRD 05: don't surface
      // the ephemeral scratchpad when transitioning from a real project
      // back to no-project).
      void loadDiracConversationForProject(projectRoot);
      return { projectRoot };
    }),

  openTab: ({ path, content }) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.path === path);
      if (existing) {
        return { activeTabPath: path };
      }
      const tab: ProjectTab = { path, content, savedContent: content, isDirty: false };
      return {
        tabs: [...s.tabs, tab],
        activeTabPath: path,
      };
    }),

  closeTab: (path) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path);
      if (idx < 0) return s;
      const tabs = [...s.tabs.slice(0, idx), ...s.tabs.slice(idx + 1)];
      let activeTabPath = s.activeTabPath;
      if (activeTabPath === path) {
        const newActive = tabs[idx - 1] ?? tabs[idx] ?? null;
        activeTabPath = newActive ? newActive.path : null;
      }
      return { tabs, activeTabPath };
    }),

  setActiveTab: (path) =>
    set((s) => {
      if (!s.tabs.some((t) => t.path === path)) return s;
      return { activeTabPath: path };
    }),

  updateActiveTabContent: (content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === s.activeTabPath
          ? { ...t, content, isDirty: content !== t.savedContent }
          : t,
      ),
    })),

  markTabSaved: (path, savedContent) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, savedContent, content: savedContent, isDirty: false } : t,
      ),
    })),

  renameTab: (oldPath, newPath) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)),
      activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath,
    })),

  closeAllTabs: () => set({ tabs: [], activeTabPath: null }),

  hasAnyDirty: () => get().tabs.some((t) => t.isDirty),
}));

// Register the project-root getter with diracStore so its auto-save
// listener writes to the correct location (project file when a project
// is open, ephemeral store otherwise). Kept as a getter rather than a
// direct import to avoid the circular dep projectStore ⇄ diracStore.
__setProjectRootGetter(() => useProjectStore.getState().projectRoot);

// If the App boots without a project root (ephemeral session), try to
// restore the ephemeral scratchpad exactly once. No-op when a project
// was restored first — setProjectRoot would have already loaded its
// conversation. Deferred to microtask so tests can mock loadBridge
// before the read fires.
queueMicrotask(() => {
  if (useProjectStore.getState().projectRoot === null &&
      useDiracStore.getState().messages.length === 0) {
    void loadDiracConversationForProject(null);
  }
});
