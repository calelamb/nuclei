/** The circuit pane's own header row (title, qubit/depth caption, Export). */
export const CIRCUIT_HEADER_PX = 40;
/** Padding above and below the diagram inside its scrolling box (4 + 6) plus the section's bottom border. */
const CIRCUIT_BODY_PAD_PX = 11;

/** Even a squeezed rail keeps this much circuit: the header and two wires. */
const CIRCUIT_ABSOLUTE_MIN_PX = 96;

/** What the circuit pane would like: its header plus the whole diagram at the fitted scale. */
export function circuitWantedHeight(svgHeight: number, scale = 1): number {
  return CIRCUIT_HEADER_PX + Math.ceil(svgHeight * scale) + CIRCUIT_BODY_PAD_PX;
}

export interface RailSplitInput {
  /** Measured height of the whole right rail (0 until measured). */
  railHeight: number;
  /** Height the histogram chip strip takes at the bottom (0 when absent). */
  chipHeight: number;
  /** circuitWantedHeight() for the current snapshot. */
  circuitWanted: number;
  /** The least the circuit keeps while squeezed (circuitMinHeight()). */
  circuitFloor: number;
  /** The least the Bloch grid keeps: one full row of spheres plus its pager when it pages. */
  blochMin: number;
  /** Maps the height offered to the Bloch section to the height its spheres use (blochUsedHeight). Omit to let it absorb all slack. */
  blochFit?: (offered: number) => number;
}

export interface RailSplit {
  /** Explicit height for the circuit pane. */
  circuit: number;
  /** Height for the Bloch section: what the spheres can use, never less than blochMin. */
  bloch: number;
}

/**
 * Split the rail between the circuit and the Bloch spheres. The circuit shows its whole diagram
 * whenever the rail can spare it, and only gives height back (down to its floor) when the spheres
 * would otherwise drop below one row. Everything left over goes to the spheres up to the size their grid
 * can use; past that the histogram chip follows them and the remainder is empty space below one block.
 * When even the floors do not fit, the rail itself scrolls, so nothing is clipped without a handle.
 */
export function planRailSplit({ railHeight, chipHeight, circuitWanted, circuitFloor, blochMin, blochFit }: RailSplitInput): RailSplit {
  if (railHeight <= 0) return { circuit: circuitWanted, bloch: blochMin };
  const available = Math.max(0, railHeight - chipHeight);
  // The floor itself yields (never below a header and two wires) so the spheres keep their row.
  const floor = Math.max(CIRCUIT_ABSOLUTE_MIN_PX, Math.min(circuitFloor, available - blochMin));
  const circuit = Math.max(floor, Math.min(circuitWanted, available - blochMin));
  const slack = Math.max(blochMin, available - circuit);
  // The spheres stop growing once their grid is full size: the chip then follows them directly.
  return { circuit, bloch: blochFit ? Math.max(blochMin, Math.min(slack, blochFit(slack))) : slack };
}
