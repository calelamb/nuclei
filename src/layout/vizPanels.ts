import type { PanelId, VisiblePanels } from './panelRegistry';

/** The main (non-chip) panels the right rail can show, in display order. */
export const MAIN_VIZ_PANEL_IDS: readonly PanelId[] = [
  'circuit',
  'bloch',
  'qecTimeline',
  'qecLattice',
  'qecDetectorGraph',
];

const QEC_PANEL_IDS: readonly PanelId[] = ['qecTimeline', 'qecLattice', 'qecDetectorGraph'];

export interface VizDataFacts {
  /** The QEC snapshot carries qubit coordinates (the lattice needs them). */
  latticeHasCoords: boolean;
}

/**
 * Which main viz panels the rail actually renders: the registry's visible set,
 * minus panels with nothing to show. The gate diagram steps aside for the QEC
 * panels (a Stim circuit is far too large to read as a diagram, and the QEC
 * panels are the right abstraction there).
 */
export function visibleVizPanelIds(visible: VisiblePanels, facts: VizDataFacts): PanelId[] {
  const ids = MAIN_VIZ_PANEL_IDS.filter((id) => {
    if (!visible[id]) return false;
    if (id === 'qecLattice' && !facts.latticeHasCoords) return false;
    return true;
  });
  const hasQec = ids.some((id) => QEC_PANEL_IDS.includes(id));
  return hasQec ? ids.filter((id) => id !== 'circuit') : ids;
}

/** Whether the right rail has anything to show. When false the column collapses and the editor takes the width. */
export function vizColumnHasContent(visible: VisiblePanels, facts: VizDataFacts, chipShown: boolean): boolean {
  return chipShown || visibleVizPanelIds(visible, facts).length > 0;
}

export type VizPlaceholder = 'booting' | 'failed' | 'noCircuit' | null;

/**
 * What holds the viz column open while it has no content of its own. Both states keep the editor
 * from changing width when the kernel's state changes: Python starting (web only, where the
 * boot is long enough to see), a run that defined no circuit, and Python failing to start (the column keeps its place and offers Retry,
 * instead of collapsing and sliding back on a retry).
 */
export function vizPlaceholder(input: {
  hasContent: boolean;
  kernelStatus: string;
  kernelReady: boolean;
  isWeb: boolean;
  /** The last run finished cleanly but defined no circuit (plain Python). */
  lastRunNoCircuit?: boolean;
}): VizPlaceholder {
  if (input.hasContent) return null;
  if (input.kernelStatus === 'failed' && !input.kernelReady) return 'failed';
  if (input.isWeb && input.kernelStatus === 'connecting') return 'booting';
  // A run that finished with nothing to draw says so in the column instead of making it vanish.
  if (input.lastRunNoCircuit) return 'noCircuit';
  return null;
}
