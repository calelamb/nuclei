import { create } from 'zustand';

export interface ProjectFile {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
}

export interface ProjectConfig {
  framework: string;
  pythonPath: string;
  kernelArgs: string[];
  defaultShots: number;
}

interface ProjectState {
  projectRoot: string | null;
  files: ProjectFile[];
  openTabs: string[]; // paths of open files
  activeTab: string | null; // path of active file
  config: ProjectConfig;
  // Actions
  setProjectRoot: (root: string | null) => void;
  addFile: (file: ProjectFile) => void;
  updateFile: (path: string, content: string) => void;
  removeFile: (path: string) => void;
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  markDirty: (path: string, dirty: boolean) => void;
  setConfig: (config: Partial<ProjectConfig>) => void;
  setFiles: (files: ProjectFile[]) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectRoot: null,
  files: [],
  openTabs: [],
  activeTab: null,
  config: {
    framework: 'qiskit',
    pythonPath: 'python3',
    kernelArgs: [],
    defaultShots: 1024,
  },

  setProjectRoot: (projectRoot) => set({ projectRoot }),

  addFile: (file) => set((s) => ({
    files: [...s.files.filter((f) => f.path !== file.path), file],
  })),

  updateFile: (path, content) => set((s) => ({
    files: s.files.map((f) => f.path === path ? { ...f, content, isDirty: true } : f),
  })),

  removeFile: (path) => set((s) => ({
    files: s.files.filter((f) => f.path !== path),
    openTabs: s.openTabs.filter((t) => t !== path),
    activeTab: s.activeTab === path ? (s.openTabs.filter((t) => t !== path)[0] ?? null) : s.activeTab,
  })),

  openTab: (path) => set((s) => ({
    openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
    activeTab: path,
  })),

  closeTab: (path) => set((s) => {
    const tabs = s.openTabs.filter((t) => t !== path);
    const idx = s.openTabs.indexOf(path);
    const newActive = s.activeTab === path
      ? (tabs[Math.min(idx, tabs.length - 1)] ?? null)
      : s.activeTab;
    return { openTabs: tabs, activeTab: newActive };
  }),

  setActiveTab: (activeTab) => set({ activeTab }),

  markDirty: (path, dirty) => set((s) => ({
    files: s.files.map((f) => f.path === path ? { ...f, isDirty: dirty } : f),
  })),

  setConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),
  setFiles: (files) => set({ files }),
}));
