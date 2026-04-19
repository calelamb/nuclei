import { create } from 'zustand';

export interface FrameworkInfo {
  id: string;
  label: string;
  description: string;
  pip_name: string;
  import_name: string;
  group: 'core' | 'provider';
  approximate_size_mb: number;
  recommended: boolean;
}

export interface FrameworkStatus {
  venv_path: string | null;
  venv_exists: boolean;
  python_version: string | null;
  system_python_path: string | null;
  installed: string[];
  catalog: FrameworkInfo[];
}

export interface InstallEvent {
  stage: 'creating-venv' | 'installing' | 'installed' | 'failed' | 'done';
  framework: string | null;
  line: string | null;
}

interface FrameworksState {
  status: FrameworkStatus | null;
  loading: boolean;
  installing: boolean;
  /** Modal visibility, shared so any component (Settings, menus) can open it. */
  modalOpen: boolean;
  /** Was the current modal shown because this is a first-run flow? */
  modalFirstRun: boolean;
  /**
   * Tail of live install events; capped so this store stays lightweight.
   * The modal reads the last N for progress display.
   */
  events: InstallEvent[];
  /** IDs of frameworks the current install targeted. */
  currentInstallSet: string[];
  /** Last install's failure list; empty on success. */
  lastFailures: string[];

  setStatus: (status: FrameworkStatus) => void;
  setLoading: (loading: boolean) => void;
  setInstalling: (installing: boolean) => void;
  openModal: (firstRun?: boolean) => void;
  closeModal: () => void;
  appendEvent: (event: InstallEvent) => void;
  resetEvents: (frameworkIds?: string[]) => void;
  setLastFailures: (failures: string[]) => void;
}

const MAX_EVENTS = 200;

export const useFrameworksStore = create<FrameworksState>((set) => ({
  status: null,
  loading: false,
  installing: false,
  modalOpen: false,
  modalFirstRun: false,
  events: [],
  currentInstallSet: [],
  lastFailures: [],

  setStatus: (status) => set({ status }),
  setLoading: (loading) => set({ loading }),
  setInstalling: (installing) => set({ installing }),
  openModal: (firstRun = false) => set({ modalOpen: true, modalFirstRun: firstRun }),
  closeModal: () => set({ modalOpen: false }),
  appendEvent: (event) =>
    set((s) => ({
      events: [...s.events.slice(-(MAX_EVENTS - 1)), event],
    })),
  resetEvents: (frameworkIds) =>
    set({ events: [], currentInstallSet: frameworkIds ?? [], lastFailures: [] }),
  setLastFailures: (failures) => set({ lastFailures: failures }),
}));

/**
 * Has the student ever completed a framework install? We consider this
 * true if the venv exists AND at least one core framework is importable.
 * Used to decide whether to auto-show the setup modal on first launch.
 */
export function needsFirstRunSetup(status: FrameworkStatus | null): boolean {
  if (!status) return false; // don't flash the modal while we're still loading
  if (!status.venv_exists) return true;
  const core = status.catalog.filter((f) => f.group === 'core').map((f) => f.id);
  return !status.installed.some((id) => core.includes(id));
}
