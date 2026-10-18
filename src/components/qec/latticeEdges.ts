import type { LatticeLayout } from './qecGeometry';

type LatticeQubit = LatticeLayout['qubits'][number];

export interface LatticeEdge {
  readonly from: number;
  readonly to: number;
}

/** Floating-point slack when comparing equal-length lattice bonds. */
const BOND_TOLERANCE = 1.05;

function distance(a: LatticeQubit, b: LatticeQubit): number {
  return Math.hypot(a.raw[0] - b.raw[0], a.raw[1] - b.raw[1]);
}

/**
 * The stabilizer bonds: each measure qubit joined to the data qubits at the
 * shortest measure-to-data distance in the lattice (its nearest neighbours),
 * measured in the circuit's own coordinates so skewed layouts stay honest.
 */
export function stabilizerEdges(qubits: readonly LatticeQubit[]): LatticeEdge[] {
  const data = qubits.filter((q) => q.kind === 'data');
  const measure = qubits.filter((q) => q.kind === 'measure');
  const pairs = measure.flatMap((m) => data.map((d) => ({ m, d, length: distance(m, d) })));
  const shortest = Math.min(...pairs.map((p) => p.length));
  if (!Number.isFinite(shortest) || shortest === 0) return [];
  return pairs
    .filter((p) => p.length <= shortest * BOND_TOLERANCE)
    .map((p) => ({ from: p.m.index, to: p.d.index }));
}
