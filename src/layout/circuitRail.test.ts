import { describe, expect, it } from 'vitest';
import { chipFitsRail, circuitMinHeight, hiddenWireCount } from './circuitRail';

describe('circuitMinHeight', () => {
  it('guarantees four wires of a five-qubit circuit when the rail has room', () => {
    expect(circuitMinHeight(5, 900)).toBe(64 + 4 * 46);
  });

  it('only asks for the wires a small circuit has', () => {
    expect(circuitMinHeight(2, 900)).toBe(64 + 2 * 46);
  });

  it('never takes more than half of a short rail, so the Bloch spheres keep a row', () => {
    expect(circuitMinHeight(5, 400)).toBe(200);
  });

  it('falls back to the full ask before the rail is measured', () => {
    expect(circuitMinHeight(5, 0)).toBe(64 + 4 * 46);
  });
});

describe('hiddenWireCount', () => {
  const box = { scrollTop: 0, clientHeight: 100, scrollHeight: 283 };

  it('counts the wires clipped under the bottom edge', () => {
    expect(hiddenWireCount(box, 5)).toBe(4);
  });

  it('is zero once scrolled to the end or when nothing overflows', () => {
    expect(hiddenWireCount({ ...box, scrollTop: 183 }, 5)).toBe(0);
    expect(hiddenWireCount({ ...box, scrollHeight: 100 }, 5)).toBe(0);
  });

  it('never claims more hidden wires than the circuit has below the first', () => {
    expect(hiddenWireCount({ scrollTop: 0, clientHeight: 20, scrollHeight: 900 }, 3)).toBe(2);
  });
});

describe('chipFitsRail', () => {
  it('keeps the chip on a tall rail', () => {
    expect(chipFitsRail({ railHeight: 760, railWidth: 316, qubitCount: 5, blochCount: 5 })).toBe(true);
  });

  it('drops the chip on the short 900x700 rail so it never overlaps the Bloch spheres', () => {
    expect(chipFitsRail({ railHeight: 435, railWidth: 316, qubitCount: 5, blochCount: 5 })).toBe(false);
  });

  it('keeps it before the rail is measured, and when there are no spheres to collide with', () => {
    expect(chipFitsRail({ railHeight: 0, railWidth: 0, qubitCount: 5, blochCount: 5 })).toBe(true);
    expect(chipFitsRail({ railHeight: 435, railWidth: 316, qubitCount: 2, blochCount: 0 })).toBe(true);
  });
});
