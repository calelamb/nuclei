import type { CircuitSnapshot } from '../../types/quantum';
import { layoutGates } from './layout';
import { WIRE_SPACING, LAYER_SPACING, LABEL_WIDTH, PADDING } from './gates';

export interface CircuitGeometry {
  hasClassical: boolean;
  /** Column per gate (input order); gates folded apart when their connectors overlap. */
  columns: number[];
  svgWidth: number;
  svgHeight: number;
  classicalWireY: number;
  wireStart: number;
  wireEnd: number;
}

/** x of the centre of a gate column. */
export function columnX(column: number): number {
  return LABEL_WIDTH + column * LAYER_SPACING + LAYER_SPACING / 2;
}

/** Shared by the live circuit panel and the read-only run diagram. */
export function computeCircuitGeometry(snapshot: CircuitSnapshot): CircuitGeometry {
  const hasClassical = snapshot.classical_bit_count > 0;
  const { columns, columnCount } = layoutGates(snapshot.gates, hasClassical);
  const svgWidth = LABEL_WIDTH + columnCount * LAYER_SPACING + PADDING;
  const lastQubitY = PADDING + (snapshot.qubit_count - 1) * WIRE_SPACING;
  const classicalWireY = lastQubitY + WIRE_SPACING * 0.9;
  return {
    hasClassical,
    columns,
    svgWidth,
    svgHeight: (hasClassical ? classicalWireY : lastQubitY) + PADDING + 8,
    classicalWireY,
    wireStart: LABEL_WIDTH - 8,
    wireEnd: svgWidth - PADDING / 2,
  };
}
