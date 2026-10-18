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

/** How many qubit wires (not the classical register) lie below the bottom edge of the scrolled diagram. */
export function hiddenQubitWires(view: WireViewport, qubitCount: number): number {
  const bottom = view.scrollTop + view.visibleHeight;
  let hidden = 0;
  for (let q = 0; q < qubitCount; q += 1) {
    const rowBottom = SCROLLER_TOP_PAD_PX + (PADDING + q * WIRE_SPACING) * view.scale + WIRE_HALF_HEIGHT_PX;
    if (rowBottom > bottom) hidden += 1;
  }
  return hidden;
}

/**
 * Whether the diagram is taller than the whole pane. Judged against the pane (scroller plus the
 * "+N wires" strip) rather than the scroller, so showing the strip cannot change the answer.
 */
export function circuitOverflows(contentHeight: number, paneHeight: number): boolean {
  return contentHeight > paneHeight;
}
