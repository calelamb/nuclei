import type { QecWorkbenchPanelId } from '../../../layout/qecPanelRegistry';

const CIRCUIT_INSTRUMENTS: ReadonlySet<QecWorkbenchPanelId> = new Set(['timeline', 'lattice', 'detector-graph']);

export interface CanvasData {
  readonly hasCircuit: boolean;
  readonly hasCampaignData: boolean;
}

/** Whether an instrument has nothing to draw yet (and so should be a short card, not a stretched field). */
export function isInstrumentEmpty(id: QecWorkbenchPanelId, data: CanvasData): boolean {
  if (CIRCUIT_INSTRUMENTS.has(id)) return !data.hasCircuit;
  if (id === 'campaign-center') return !data.hasCampaignData;
  // Stream health and the calibration timeline have no data source yet.
  return true;
}

export interface CanvasGrid {
  /** True when every instrument is empty: rows size to their content. */
  readonly compact: boolean;
  readonly gridTemplateRows: string;
  /** How many rows the leading instrument spans. */
  readonly primaryRowSpan: number;
  /** Index of an instrument that takes the whole row so an odd count leaves no hole. */
  readonly fullWidthIndex: number | null;
}

/**
 * Row model for the two-column canvas. Rows are never shorter than their
 * content (`max-content` minimum), so two cards can never overlap; with data
 * the leading instrument spans the rest, with none every card is short and an
 * odd last card runs the full width instead of leaving a hole beside it.
 */
export function canvasGrid(panelCount: number, allEmpty: boolean): CanvasGrid {
  if (allEmpty) {
    const rows = Math.max(1, Math.ceil(panelCount / 2));
    return {
      compact: true,
      gridTemplateRows: `repeat(${rows}, max-content)`,
      primaryRowSpan: 1,
      fullWidthIndex: panelCount > 1 && panelCount % 2 === 1 ? panelCount - 1 : null,
    };
  }
  const rows = Math.max(1, panelCount - 1);
  return { compact: false, gridTemplateRows: `repeat(${rows}, minmax(max-content, 1fr))`, primaryRowSpan: rows, fullWidthIndex: null };
}
