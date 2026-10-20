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
  /**
   * True when the instruments after the leading one live in their own rail column.
   * The leading card then keeps a fixed, viewport-sized height and the rail grows
   * to its content, so neither can stretch the other.
   */
  readonly railed: boolean;
}

/**
 * Row model for the two-column canvas. With nothing to draw every card is
 * short and an odd last card runs the full width instead of leaving a hole
 * beside it. With data the leading instrument sits beside a rail of the
 * others: it never spans content-sized rows, so it cannot be stretched around
 * empty space, and the rail cards keep their own natural height.
 */
export function canvasGrid(panelCount: number, allEmpty: boolean): CanvasGrid {
  if (allEmpty) {
    const rows = Math.max(1, Math.ceil(panelCount / 2));
    return {
      compact: true,
      gridTemplateRows: `repeat(${rows}, max-content)`,
      primaryRowSpan: 1,
      fullWidthIndex: panelCount > 1 && panelCount % 2 === 1 ? panelCount - 1 : null,
      railed: false,
    };
  }
  return { compact: false, gridTemplateRows: 'max-content', primaryRowSpan: 1, fullWidthIndex: null, railed: panelCount > 1 };
}
