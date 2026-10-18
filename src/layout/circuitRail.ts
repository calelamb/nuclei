import { WIRE_SPACING } from '../components/circuit/gates';
import { blochRailHeights } from './blochRail';

/** What the histogram chip strip needs below the panels (the chip plus its padding). */
export const HISTOGRAM_CHIP_RESERVE_PX = 96;

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

export interface ScrollMetrics { scrollTop: number; clientHeight: number; scrollHeight: number }

/** How many whole wires the bottom edge of the scrolled diagram is hiding. */
export function hiddenWireCount(box: ScrollMetrics, qubitCount: number): number {
  const below = box.scrollHeight - box.scrollTop - box.clientHeight;
  if (below <= WIRE_SPACING / 2) return 0;
  return Math.min(Math.max(0, qubitCount - 1), Math.max(1, Math.round(below / WIRE_SPACING)));
}

/**
 * Whether the histogram chip strip still fits under the circuit and a one-row Bloch rail. When the rail is short
 * the chip steps aside rather than overlapping the spheres; its data stays in the Terminal and the Histogram tab.
 */
export function chipFitsRail(input: { railHeight: number; railWidth: number; qubitCount: number; blochCount: number }): boolean {
  if (input.railHeight <= 0) return true;
  const blochMin = input.blochCount > 0 ? blochRailHeights(input.blochCount, input.railWidth).min : 0;
  return input.railHeight >= circuitMinHeight(input.qubitCount, input.railHeight) + blochMin + HISTOGRAM_CHIP_RESERVE_PX;
}
