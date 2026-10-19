import { GATE_SIZE, LABEL_WIDTH, LAYER_SPACING, PADDING, WIRE_SPACING } from '../circuit/gates';
import type { Gate } from '../../types/quantum';

export const GLYPH_SIZE = GATE_SIZE - 6;

export function wireY(qubit: number): number {
  return PADDING + qubit * WIRE_SPACING;
}

export function gateX(layer: number): number {
  return LABEL_WIDTH + layer * LAYER_SPACING + LAYER_SPACING / 2;
}

/** Bounding box of a gate's glyph, for hover/overlay hit areas. */
export function glyphBounds(gate: Gate): { x: number; y: number; width: number; height: number } {
  const qubits = [...gate.controls, ...gate.targets];
  const ys = (qubits.length > 0 ? qubits : [0]).map(wireY);
  const top = Math.min(...ys) - GLYPH_SIZE / 2;
  const bottom = Math.max(...ys) + GLYPH_SIZE / 2;
  return { x: gateX(gate.layer) - GLYPH_SIZE / 2, y: top, width: GLYPH_SIZE, height: bottom - top };
}
