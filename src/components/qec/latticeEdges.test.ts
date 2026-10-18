import { describe, expect, it } from 'vitest';
import { stabilizerEdges } from './latticeEdges';
import type { LatticeLayout } from './qecGeometry';

type Q = LatticeLayout['qubits'][number];
const q = (index: number, x: number, y: number, kind: Q['kind']): Q => ({
  index, x, y, raw: [x, y], kind, basis: kind === 'measure' ? 'Z' : 'unknown',
});

describe('stabilizerEdges', () => {
  it('joins each measure qubit only to its nearest data qubits', () => {
    const qubits = [q(0, 0, 0, 'data'), q(1, 2, 0, 'data'), q(2, 1, 0, 'measure'), q(3, 9, 9, 'data')];
    expect(stabilizerEdges(qubits)).toEqual([{ from: 2, to: 0 }, { from: 2, to: 1 }]);
  });

  it('returns nothing without both kinds of qubit', () => {
    expect(stabilizerEdges([q(0, 0, 0, 'data')])).toEqual([]);
    expect(stabilizerEdges([])).toEqual([]);
  });
});
