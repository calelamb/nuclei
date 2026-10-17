import { beforeEach, describe, expect, it } from 'vitest';
import { useCircuitStore, selectDisplaySnapshot } from './circuitStore';
import { useProjectStore } from './projectStore';
import type { CircuitSnapshot } from '../types/quantum';

const snap = (n = 2): CircuitSnapshot => ({
  framework: 'qiskit', qubit_count: n, classical_bit_count: 0, depth: 1,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
});

describe('circuitStore display snapshot latch', () => {
  beforeEach(() => {
    useProjectStore.setState({ tabs: [], activeTabPath: '/p/a.py', projectRoot: '/p' });
    useCircuitStore.setState({ snapshot: null, lastGood: null, snapshotKey: null, error: null });
  });

  it('keeps the last good snapshot when a parse error nulls the live one', () => {
    const good = snap();
    useCircuitStore.getState().setSnapshot(good);
    useCircuitStore.getState().setSnapshot(null);
    useCircuitStore.getState().setError('SyntaxError');
    const display = selectDisplaySnapshot(useCircuitStore.getState(), '/p/a.py');
    expect(display).toEqual({ snapshot: good, stale: true });
  });

  it('does not show another tab\'s circuit as stale', () => {
    useCircuitStore.getState().setSnapshot(snap());
    useCircuitStore.getState().setSnapshot(null);
    expect(selectDisplaySnapshot(useCircuitStore.getState(), '/p/b.py')).toEqual({ snapshot: null, stale: false });
  });

  it('a fresh snapshot replaces the latch and is not stale', () => {
    useCircuitStore.getState().setSnapshot(snap(2));
    useCircuitStore.getState().setSnapshot(null);
    const fresh = snap(3);
    useCircuitStore.getState().setSnapshot(fresh);
    expect(selectDisplaySnapshot(useCircuitStore.getState(), '/p/a.py')).toEqual({ snapshot: fresh, stale: false });
    expect(useCircuitStore.getState().lastGood).toBeNull();
  });

  it('never latches an empty circuit', () => {
    useCircuitStore.getState().setSnapshot({ ...snap(), gates: [] });
    useCircuitStore.getState().setSnapshot(null);
    expect(selectDisplaySnapshot(useCircuitStore.getState(), '/p/a.py').snapshot).toBeNull();
  });

  it('consecutive null snapshots keep the original latch', () => {
    const good = snap();
    useCircuitStore.getState().setSnapshot(good);
    useCircuitStore.getState().setSnapshot(null);
    useCircuitStore.getState().setSnapshot(null);
    expect(selectDisplaySnapshot(useCircuitStore.getState(), '/p/a.py').snapshot).toBe(good);
  });

  it('clear() drops the latch', () => {
    useCircuitStore.getState().setSnapshot(snap());
    useCircuitStore.getState().setSnapshot(null);
    useCircuitStore.getState().clear();
    expect(selectDisplaySnapshot(useCircuitStore.getState(), '/p/a.py').snapshot).toBeNull();
  });
});
