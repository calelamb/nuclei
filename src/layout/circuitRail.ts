import { PADDING, WIRE_SPACING } from '../components/circuit/gates';

/** Header row, padding and one wire's breathing room around the wires themselves. */
const CIRCUIT_CHROME_PX = 64;
/** The circuit is guaranteed room for this many wires when the rail is short; taller circuits scroll. */
export const CIRCUIT_PRIORITY_WIRES = 4;
/** On a short rail the circuit never claims more than this share, so the Bloch spheres keep a row. */
const CIRCUIT_MAX_SHARE = 0.5;

/**
 * The least height the circuit panel keeps while the rail is squeezed: room for min(qubits, 4)
 * wires, capped at half the rail. The Bloch grid pages and shrinks first (it has a pager); a
 * circuit squeezed to two wires reads as a different, smaller circuit.
 */
export function circuitMinHeight(qubitCount: number, railHeight: number): number {
  const wires = Math.max(1, Math.min(Math.floor(qubitCount), CIRCUIT_PRIORITY_WIRES));
  const wanted = CIRCUIT_CHROME_PX + wires * WIRE_SPACING;
  if (railHeight <= 0) return wanted;
  return Math.min(wanted, Math.floor(railHeight * CIRCUIT_MAX_SHARE));
}

/** Vertical padding of the scrolling diagram box, above the first wire. */
const SCROLLER_TOP_PAD_PX = 4;
/** Half the height of a gate box: a wire counts as visible once its gate row clears the bottom edge. */
const WIRE_HALF_HEIGHT_PX = 8;

export interface WireViewport { scrollTop: number; visibleHeight: number; scale: number }

/** Where the classical register's double wire sits, relative to the last qubit (matches computeCircuitGeometry). */
const CLASSICAL_WIRE_OFFSET = 0.9;

/**
 * How many wires lie below the bottom edge of the scrolled diagram: the qubit wires, plus the classical
 * register (one wire, "c/N") when the circuit has one - it used to be clipped without any "+1 wire" hint.
 */
export function hiddenQubitWires(view: WireViewport, qubitCount: number, hasClassical = false): number {
  const bottom = view.scrollTop + view.visibleHeight;
  const rowBottom = (wireIndex: number) => SCROLLER_TOP_PAD_PX + (PADDING + wireIndex * WIRE_SPACING) * view.scale + WIRE_HALF_HEIGHT_PX;
  let hidden = 0;
  for (let q = 0; q < qubitCount; q += 1) {
    if (rowBottom(q) > bottom) hidden += 1;
  }
  if (hasClassical && qubitCount > 0 && rowBottom(qubitCount - 1 + CLASSICAL_WIRE_OFFSET) > bottom) hidden += 1;
  return hidden;
}

/**
 * Whether the diagram is taller than the whole pane. Judged against the pane (scroller plus the
 * "+N wires" strip) rather than the scroller, so showing the strip cannot change the answer.
 */
export function circuitOverflows(contentHeight: number, paneHeight: number): boolean {
  return contentHeight > paneHeight;
}
