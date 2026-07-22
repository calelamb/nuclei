import type { QecWorkspacePreset } from '../types/qecStudy';

export type QecWorkbenchZone = 'sources' | 'canvas' | 'inspector' | 'tray';

export type QecWorkbenchPanelId =
  | 'editor'
  | 'timeline'
  | 'lattice'
  | 'detector-graph'
  | 'campaign-center'
  | 'failure-microscope'
  | 'stream-health'
  | 'calibration-timeline'
  | 'research-inspector'
  | 'jobs';

export interface QecWorkbenchPanelDef {
  id: QecWorkbenchPanelId;
  title: string;
  zone: QecWorkbenchZone;
  presets: readonly QecWorkspacePreset[];
  order: number;
}

export interface QecResolvedPreset {
  primary: readonly QecWorkbenchPanelId[];
  inspector: readonly QecWorkbenchPanelId[];
  tray: readonly QecWorkbenchPanelId[];
}

const QEC_PANELS: readonly QecWorkbenchPanelDef[] = [
  { id: 'editor', title: 'Editor', zone: 'sources', presets: ['build'], order: 0 },
  { id: 'timeline', title: 'Timeline', zone: 'canvas', presets: ['build', 'analyze'], order: 1 },
  { id: 'lattice', title: 'Code Lattice', zone: 'canvas', presets: ['build', 'analyze'], order: 2 },
  {
    id: 'detector-graph',
    title: 'Detector Graph',
    zone: 'canvas',
    presets: ['build', 'analyze'],
    order: 3,
  },
  {
    id: 'campaign-center',
    title: 'Campaign Center',
    zone: 'canvas',
    presets: ['analyze'],
    order: 4,
  },
  {
    id: 'failure-microscope',
    title: 'Failure Microscope',
    zone: 'inspector',
    presets: ['analyze'],
    order: 5,
  },
  { id: 'stream-health', title: 'Stream Health', zone: 'canvas', presets: ['observe'], order: 6 },
  {
    id: 'calibration-timeline',
    title: 'Calibration Timeline',
    zone: 'canvas',
    presets: ['observe'],
    order: 7,
  },
  {
    id: 'research-inspector',
    title: 'Research Inspector',
    zone: 'inspector',
    presets: ['build', 'analyze', 'observe'],
    order: 8,
  },
  { id: 'jobs', title: 'Jobs', zone: 'tray', presets: ['build', 'analyze', 'observe'], order: 9 },
];

export function validateQecPanelRegistry(
  panels: readonly QecWorkbenchPanelDef[],
): readonly QecWorkbenchPanelDef[] {
  const ids = new Set<QecWorkbenchPanelId>();
  const orders = new Set<number>();

  for (const panel of panels) {
    if (ids.has(panel.id)) throw new Error(`Duplicate QEC workbench panel id: ${panel.id}`);
    if (orders.has(panel.order)) throw new Error(`Duplicate QEC workbench panel order: ${panel.order}`);
    ids.add(panel.id);
    orders.add(panel.order);
  }

  return Object.freeze(
    [...panels]
      .sort((left, right) => left.order - right.order)
      .map((panel) => Object.freeze({ ...panel, presets: Object.freeze([...panel.presets]) })),
  );
}

export const QEC_PANEL_REGISTRY = validateQecPanelRegistry(QEC_PANELS);

function panelsForPreset(preset: QecWorkspacePreset): readonly QecWorkbenchPanelDef[] {
  return QEC_PANEL_REGISTRY.filter((panel) => panel.presets.includes(preset));
}

function idsInZones(
  panels: readonly QecWorkbenchPanelDef[],
  zones: readonly QecWorkbenchZone[],
): readonly QecWorkbenchPanelId[] {
  return Object.freeze(panels.filter((panel) => zones.includes(panel.zone)).map((panel) => panel.id));
}

/** Resolve the deterministic zone arrangement for a named QEC workspace preset. */
export function resolveQecPreset(preset: QecWorkspacePreset): QecResolvedPreset {
  const panels = panelsForPreset(preset);
  return Object.freeze({
    primary: idsInZones(panels, ['sources', 'canvas']),
    inspector: idsInZones(panels, ['inspector']),
    tray: idsInZones(panels, ['tray']),
  });
}
