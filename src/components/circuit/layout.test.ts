import { describe, it, expect } from 'vitest';
import { layoutGates } from './layout';
import type { Gate } from '../../types/quantum';

function gate(type: string, targets: number[], controls: number[] = [], layer = 0, params: number[] = []): Gate {
  return { type, targets, controls, params, layer } as Gate;
}

describe('layoutGates', () => {
  it('keeps gates on disjoint wires in one column', () => {
    const out = layoutGates([gate('H', [0]), gate('X', [1])], false);
    expect(out.columns).toEqual([0, 0]);
    expect(out.columnCount).toBe(1);
  });

  it('splits a CZ(0,5) from SWAP(1,4) and an RY inside its span', () => {
    const out = layoutGates(
      [gate('CZ', [5], [0]), gate('SWAP', [1, 4]), gate('RY', [3], [], 0, [0.3])],
      false,
    );
    expect(new Set(out.columns).size).toBe(3);
    expect(out.columnCount).toBe(3);
  });

  it('separates measurements whose drop lines would cross a lower meter', () => {
    const out = layoutGates([gate('MEASURE', [0], [], 1), gate('MEASURE', [1], [], 1)], true);
    expect(out.columns[0]).not.toBe(out.columns[1]);
  });

  it('lets measurements share a column when there is no classical register', () => {
    const out = layoutGates([gate('MEASURE', [0], [], 1), gate('MEASURE', [1], [], 1)], false);
    expect(out.columns[0]).toBe(out.columns[1]);
  });

  it('offsets later layers by the sub-columns of earlier ones', () => {
    const out = layoutGates([gate('CZ', [2], [0], 0), gate('H', [1], [], 0), gate('X', [0], [], 1)], false);
    expect(out.columns).toEqual([0, 1, 2]);
    expect(out.columnCount).toBe(3);
  });

  it('returns zero columns for an empty circuit', () => {
    expect(layoutGates([], false)).toEqual({ columns: [], columnCount: 0 });
  });
});
