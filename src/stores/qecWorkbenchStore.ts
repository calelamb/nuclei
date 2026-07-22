import { create } from 'zustand';
import type { QecWorkspacePreset } from '../types/qecStudy';
import type { QecWorkbenchPanelId } from '../layout/qecPanelRegistry';

export const QEC_WORKBENCH_STORAGE_KEY = 'nuclei:qec_workbench';

const DEFAULT_SOURCE_WIDTH = 280;
const DEFAULT_INSPECTOR_WIDTH = 360;
const DEFAULT_TRAY_HEIGHT = 260;
const MIN_SOURCE_WIDTH = 220;
const MAX_SOURCE_WIDTH = 480;
const MIN_INSPECTOR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 560;
const MIN_TRAY_HEIGHT = 160;
const MAX_TRAY_HEIGHT = 520;

const QEC_PRESETS: readonly QecWorkspacePreset[] = ['build', 'analyze', 'observe'];
const QEC_PANEL_IDS: readonly QecWorkbenchPanelId[] = [
  'editor',
  'timeline',
  'lattice',
  'detector-graph',
  'campaign-center',
  'failure-microscope',
  'stream-health',
  'calibration-timeline',
  'research-inspector',
  'jobs',
];

export interface QecWorkbenchState {
  preset: QecWorkspacePreset;
  pinnedPanelIds: readonly QecWorkbenchPanelId[];
  sourceWidth: number;
  inspectorWidth: number;
  trayHeight: number;
  setPreset(preset: QecWorkspacePreset): void;
  pinPanel(panelId: QecWorkbenchPanelId): void;
  unpinPanel(panelId: QecWorkbenchPanelId): void;
  setSourceWidth(width: number): void;
  setInspectorWidth(width: number): void;
  setTrayHeight(height: number): void;
}

export type QecWorkbenchPersistedState = Pick<
  QecWorkbenchState,
  'preset' | 'pinnedPanelIds' | 'sourceWidth' | 'inspectorWidth' | 'trayHeight'
>;

function isPreset(value: unknown): value is QecWorkspacePreset {
  return typeof value === 'string' && QEC_PRESETS.includes(value as QecWorkspacePreset);
}

function isPanelId(value: unknown): value is QecWorkbenchPanelId {
  return typeof value === 'string' && QEC_PANEL_IDS.includes(value as QecWorkbenchPanelId);
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function persistedState(state: QecWorkbenchPersistedState): QecWorkbenchPersistedState {
  return {
    preset: state.preset,
    pinnedPanelIds: Object.freeze([...state.pinnedPanelIds]),
    sourceWidth: state.sourceWidth,
    inspectorWidth: state.inspectorWidth,
    trayHeight: state.trayHeight,
  };
}

/** Load validated state from local storage. Invalid individual values use safe defaults. */
export function loadQecWorkbenchState(): QecWorkbenchPersistedState {
  const defaults: QecWorkbenchPersistedState = {
    preset: 'build',
    pinnedPanelIds: Object.freeze([]),
    sourceWidth: DEFAULT_SOURCE_WIDTH,
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    trayHeight: DEFAULT_TRAY_HEIGHT,
  };

  try {
    const raw = localStorage.getItem(QEC_WORKBENCH_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return defaults;
    const value = parsed as Record<string, unknown>;
    const pins = Array.isArray(value.pinnedPanelIds)
      ? value.pinnedPanelIds.filter(isPanelId).filter((id, index, ids) => ids.indexOf(id) === index)
      : [];

    return {
      preset: isPreset(value.preset) ? value.preset : 'build',
      pinnedPanelIds: Object.freeze(pins),
      sourceWidth: clamp(value.sourceWidth, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH, DEFAULT_SOURCE_WIDTH),
      inspectorWidth: clamp(
        value.inspectorWidth,
        MIN_INSPECTOR_WIDTH,
        MAX_INSPECTOR_WIDTH,
        DEFAULT_INSPECTOR_WIDTH,
      ),
      trayHeight: clamp(value.trayHeight, MIN_TRAY_HEIGHT, MAX_TRAY_HEIGHT, DEFAULT_TRAY_HEIGHT),
    };
  } catch {
    return defaults;
  }
}

function persist(state: QecWorkbenchPersistedState): void {
  try {
    localStorage.setItem(QEC_WORKBENCH_STORAGE_KEY, JSON.stringify(persistedState(state)));
  } catch {
    // Persistence is non-critical in restricted environments.
  }
}

function updatePersistedState(
  set: (partial: Partial<QecWorkbenchState>) => void,
  current: () => QecWorkbenchState,
  update: (state: QecWorkbenchPersistedState) => QecWorkbenchPersistedState,
): void {
  const next = update(persistedState(current()));
  set(next);
  persist(next);
}

export const useQecWorkbenchStore = create<QecWorkbenchState>((set, get) => ({
  ...loadQecWorkbenchState(),
  setPreset: (preset) => updatePersistedState(set, get, (state) => ({ ...state, preset })),
  pinPanel: (panelId) =>
    updatePersistedState(set, get, (state) =>
      state.pinnedPanelIds.includes(panelId)
        ? { ...state, pinnedPanelIds: Object.freeze([...state.pinnedPanelIds]) }
        : { ...state, pinnedPanelIds: Object.freeze([...state.pinnedPanelIds, panelId]) },
    ),
  unpinPanel: (panelId) =>
    updatePersistedState(set, get, (state) => ({
      ...state,
      pinnedPanelIds: Object.freeze(state.pinnedPanelIds.filter((id) => id !== panelId)),
    })),
  setSourceWidth: (width) =>
    updatePersistedState(set, get, (state) => ({
      ...state,
      sourceWidth: clamp(width, MIN_SOURCE_WIDTH, MAX_SOURCE_WIDTH, state.sourceWidth),
    })),
  setInspectorWidth: (width) =>
    updatePersistedState(set, get, (state) => ({
      ...state,
      inspectorWidth: clamp(width, MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH, state.inspectorWidth),
    })),
  setTrayHeight: (height) =>
    updatePersistedState(set, get, (state) => ({
      ...state,
      trayHeight: clamp(height, MIN_TRAY_HEIGHT, MAX_TRAY_HEIGHT, state.trayHeight),
    })),
}));
