import { create } from 'zustand';

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

  setProjectRoot: (projectRoot) => set({ projectRoot }),

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
