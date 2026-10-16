import { describe, it, expect } from 'vitest';
import { parseQecExplainData } from './qecExplain';

describe('parseQecExplainData', () => {
  it('accepts a nondeterministic + min_weight payload and keeps unknown fields', () => {
    const r = parseQecExplainData({
      nondeterministic: {
        status: 'nondeterministic', sentence: 'D2 is non-deterministic', line: 7, tick: 3,
        detector_indices: [2], operation: { description: 'Z-basis reset (R)', qubits: [0] },
        diagram_svg: '<svg/>', future_field: 1,
      },
      min_weight: {
        status: 'ok', sentence: 's', weight: 3, num_detectors: 8, num_observables: 1,
        faults: [{ index: 0, located: true, tick: 1, qubits: [0, 1], gate: 'DEPOLARIZE2', line: 4 }],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.min_weight?.faults[0].qubits).toEqual([0, 1]);
      expect(r.data.nondeterministic?.detector_indices).toEqual([2]);
    }
  });

  it('defaults missing arrays and tolerates null line', () => {
    const r = parseQecExplainData({ nondeterministic: { status: 'ok', sentence: 'fine', line: null } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.nondeterministic?.detector_indices).toEqual([]);
  });

  it('rejects a malformed payload with a path-bearing message', () => {
    const r = parseQecExplainData({ nondeterministic: { status: 'weird', sentence: 's' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/malformed at nondeterministic\.status/);
  });

  it('rejects a non-object payload', () => {
    expect(parseQecExplainData(null).ok).toBe(false);
  });

  it('rejects a zero or negative line number', () => {
    expect(parseQecExplainData({ nondeterministic: { status: 'ok', sentence: 's', line: 0 } }).ok).toBe(false);
  });
});
