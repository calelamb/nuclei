import type { Gate } from '../../types/quantum';

const MEASURE_NAMES = new Set(['MEASURE', 'M', 'MZ']);

export interface GateLayout {
  /** Column index for each gate, in input order. */
  columns: number[];
  columnCount: number;
}

interface Span {
  lo: number;
  hi: number;
}

function spanOf(gate: Gate, hasClassical: boolean): Span {
  const qubits = [...gate.targets, ...gate.controls];
  const lo = Math.min(...qubits);
  const hi = Math.max(...qubits);
  // A measurement drops a double line to the classical register below the wires.
  const drops = hasClassical && MEASURE_NAMES.has(gate.type.toUpperCase());
  return { lo, hi: drops ? Number.POSITIVE_INFINITY : hi };
}

function overlaps(a: Span, b: Span): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

/**
 * Assigns each gate an x column. Gates in the same kernel layer share a column
 * only when their vertical spans (connectors, measurement drop lines) do not
 * overlap; otherwise they fold into extra sub-columns, the way Qiskit's drawer
 * does, so a long control line never reads as passing through another gate.
 */
export function layoutGates(gates: readonly Gate[], hasClassical: boolean): GateLayout {
  if (gates.length === 0) return { columns: [], columnCount: 0 };
  const layers = [...new Set(gates.map((g) => g.layer))].sort((a, b) => a - b);
  const columns = new Array<number>(gates.length).fill(0);
  let offset = 0;
  for (const layer of layers) {
    const subColumns: Span[][] = [];
    gates.forEach((gate, index) => {
      if (gate.layer !== layer) return;
      const span = spanOf(gate, hasClassical);
      let slot = subColumns.findIndex((placed) => !placed.some((p) => overlaps(p, span)));
      if (slot === -1) {
        slot = subColumns.length;
        subColumns.push([]);
      }
      subColumns[slot] = [...subColumns[slot], span];
      columns[index] = offset + slot;
    });
    offset += subColumns.length;
  }
  return { columns, columnCount: offset };
}
