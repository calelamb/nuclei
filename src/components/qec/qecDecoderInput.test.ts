import { describe, expect, it } from 'vitest';
import { buildDecodeInput, decodedToOverlay } from './qecDecoderInput';
import type { DetectorGraphLayout } from './qecGeometry';
import type { DecodedResult } from '../../lib/qecDecoderWasm';

const layout: DetectorGraphLayout = {
  nodes: [
    { detector: 0, x: 0.1, y: 0.5 },
    { detector: 1, x: 0.4, y: 0.5 },
    { detector: 2, x: 0.7, y: 0.5 },
  ],
  boundary: { x: 0.5, y: 0.97 },
  edges: [
    { a: 0, b: 1, p: 0.1, obs: [] },
    { a: 1, b: 2, p: 0.01, obs: [] },
    { a: 2, b: -1, p: 0.05, obs: [0] },
  ],
  hasCoordinates: true,
};

describe('buildDecodeInput', () => {
  it('converts probabilities to -ln(p) matching weights and sorts the syndrome', () => {
    const input = buildDecodeInput(layout, 3, 1, new Set([2, 0]));
    expect(input.num_detectors).toBe(3);
    expect(input.num_observables).toBe(1);
    expect(input.syndrome).toEqual([0, 2]); // sorted
    // -ln(0.1) ≈ 2.302; likelier edge (p=0.1) is cheaper than the rarer (p=0.01).
    const e01 = input.edges.find((e) => e.a === 0 && e.b === 1)!;
    const e12 = input.edges.find((e) => e.a === 1 && e.b === 2)!;
    expect(e01.weight).toBeCloseTo(-Math.log(0.1), 6);
    expect(e01.weight).toBeLessThan(e12.weight);
    // boundary edge keeps b = -1 and its observable frame.
    const eb = input.edges.find((e) => e.b === -1)!;
    expect(eb.obs).toEqual([0]);
  });

  it('clamps degenerate probabilities so weights stay finite', () => {
    const degenerate: DetectorGraphLayout = {
      ...layout,
      edges: [{ a: 0, b: 1, p: 0, obs: [] }],
    };
    const input = buildDecodeInput(degenerate, 2, 0, new Set());
    expect(Number.isFinite(input.edges[0].weight)).toBe(true);
  });
});

describe('decodedToOverlay', () => {
  it('maps correction edges to the overlay and flags an observable-crossing correction', () => {
    const decoded: DecodedResult = {
      matched: [{ a: 2, b: -1 }],
      correction_edges: [{ a: 2, b: -1 }],
      predicted_flips: [true],
    };
    const overlay = decodedToOverlay(new Set([2]), decoded);
    expect([...overlay.firedDetectors]).toEqual([2]);
    expect(overlay.matchedEdges).toEqual([{ a: 2, b: -1 }]);
    expect(overlay.logicalError).toBe(true);
  });

  it('reports no logical error when the correction flips nothing', () => {
    const decoded: DecodedResult = {
      matched: [{ a: 0, b: 1 }],
      correction_edges: [{ a: 0, b: 1 }],
      predicted_flips: [false],
    };
    expect(decodedToOverlay(new Set([0, 1]), decoded).logicalError).toBe(false);
  });
});
