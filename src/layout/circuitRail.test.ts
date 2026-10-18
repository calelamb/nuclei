import { describe, expect, it } from 'vitest';
import { WIRE_SPACING } from '../components/circuit/gates';
import { circuitMinHeight, circuitOverflows, hiddenQubitWires } from './circuitRail';

describe('circuitMinHeight', () => {
  it('guarantees four wires of a five-qubit circuit when the rail has room', () => {
    expect(circuitMinHeight(5, 900)).toBe(64 + 4 * WIRE_SPACING);
  });

  it('only asks for the wires a small circuit has', () => {
    expect(circuitMinHeight(2, 900)).toBe(64 + 2 * WIRE_SPACING);
  });

  it('never takes more than half of a short rail, so the Bloch spheres keep a row', () => {
    expect(circuitMinHeight(5, 400)).toBe(200);
  });

  it('falls back to the full ask before the rail is measured', () => {
    expect(circuitMinHeight(5, 0)).toBe(64 + 4 * WIRE_SPACING);
  });
});

describe('hiddenQubitWires', () => {
  it('counts only qubit wires below the visible bottom edge, never the classical register', () => {
    // 5 qubits: wires at 24 + 52q (4px scroller padding). 200px visible shows q0..q3 (q3 at 180).
    expect(hiddenQubitWires({ scrollTop: 0, visibleHeight: 200, scale: 1 }, 5)).toBe(1);
    expect(hiddenQubitWires({ scrollTop: 0, visibleHeight: 400, scale: 1 }, 5)).toBe(0);
  });

  it('follows the scroll position and the fit scale', () => {
    expect(hiddenQubitWires({ scrollTop: 60, visibleHeight: 200, scale: 1 }, 5)).toBe(0);
    expect(hiddenQubitWires({ scrollTop: 0, visibleHeight: 200, scale: 0.5 }, 5)).toBe(0);
  });
});

describe('circuitOverflows', () => {
  it('compares content with the whole pane, so showing the strip cannot flip the answer', () => {
    expect(circuitOverflows(300, 280)).toBe(true);
    expect(circuitOverflows(280, 280)).toBe(false);
    expect(circuitOverflows(100, 280)).toBe(false);
  });
});
