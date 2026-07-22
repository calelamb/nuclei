import { create } from 'zustand';
import type { QecWorkbenchPanelId } from '../layout/qecPanelRegistry';
import type { QecWorkspacePreset } from '../types/qecStudy';

export const QEC_WORKBENCH_DIMENSIONS = Object.freeze({
  source: Object.freeze({ min: 220, max: 480 }),
  inspector: Object.freeze({ min: 280, max: 560 }),
  tray: Object.freeze({ min: 160, max: 520 }),
});

export interface QecWorkbenchPersistedState {
  preset: QecWorkspacePreset;
  pinnedPanelIds: readonly QecWorkbenchPanelId[];
  sourceWidth: number;
  inspectorWidth: number;
  trayHeight: number;
  trayCollapsed: boolean;
}

export const QEC_WORKBENCH_DEFAULTS: QecWorkbenchPersistedState = Object.freeze({
  preset: 'build',
  pinnedPanelIds: Object.freeze([]),
  sourceWidth: 280,
  inspectorWidth: 360,
  trayHeight: 260,
  trayCollapsed: false,
});

export type QecPersistenceOperation = 'read' | 'write';

export interface QecPersistenceIssue {
  scopeKey: string;
  token: number;
  operation: QecPersistenceOperation;
  message: string;
  instruction: string;
  retrying: boolean;
  retry(): void;
}

export interface QecWorkbenchState extends QecWorkbenchPersistedState {
  persistenceError: string | null;
  persistenceIssue: QecPersistenceIssue | null;
  setPreset(preset: QecWorkspacePreset): void;
  pinPanel(panelId: QecWorkbenchPanelId): void;
  unpinPanel(panelId: QecWorkbenchPanelId): void;
  setSourceWidth(width: number): void;
  setInspectorWidth(width: number): void;
  setTrayHeight(height: number): void;
  setTrayCollapsed(collapsed: boolean): void;
  toggleTrayCollapsed(): void;
  hydrate(state: QecWorkbenchPersistedState): void;
  setPersistenceError(error: string | null): void;
  setPersistenceIssue(issue: QecPersistenceIssue | null): void;
}

function clamp(value: number, range: { readonly min: number; readonly max: number }, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

export const useQecWorkbenchStore = create<QecWorkbenchState>((set) => ({
  ...QEC_WORKBENCH_DEFAULTS,
  persistenceError: null,
  persistenceIssue: null,
  setPreset: (preset) => set({ preset }),
  pinPanel: (panelId) => set((state) => ({
    pinnedPanelIds: Object.freeze(state.pinnedPanelIds.includes(panelId)
      ? [...state.pinnedPanelIds]
      : [...state.pinnedPanelIds, panelId]),
  })),
  unpinPanel: (panelId) => set((state) => ({
    pinnedPanelIds: Object.freeze(state.pinnedPanelIds.filter((id) => id !== panelId)),
  })),
  setSourceWidth: (width) => set((state) => ({
    sourceWidth: clamp(width, QEC_WORKBENCH_DIMENSIONS.source, state.sourceWidth),
  })),
  setInspectorWidth: (width) => set((state) => ({
    inspectorWidth: clamp(width, QEC_WORKBENCH_DIMENSIONS.inspector, state.inspectorWidth),
  })),
  setTrayHeight: (height) => set((state) => ({
    trayHeight: clamp(height, QEC_WORKBENCH_DIMENSIONS.tray, state.trayHeight),
  })),
  setTrayCollapsed: (trayCollapsed) => set({ trayCollapsed }),
  toggleTrayCollapsed: () => set((state) => ({ trayCollapsed: !state.trayCollapsed })),
  hydrate: (state) => set({ ...state, pinnedPanelIds: Object.freeze([...state.pinnedPanelIds]) }),
  setPersistenceError: (persistenceError) => set({ persistenceError }),
  setPersistenceIssue: (persistenceIssue) => set({
    persistenceIssue,
    persistenceError: persistenceIssue?.message ?? null,
  }),
}));
