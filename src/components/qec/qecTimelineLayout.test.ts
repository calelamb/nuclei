import { describe, expect, it } from 'vitest';
import { subColumnCentre, timelineColumnLayout, type TimelinePackGate } from './qecTimelineLayout';

const OPTS = { subColumnPx: 28, minLayerPx: 34 };

function cx(gateIndex: number, layer: number, control: number, target: number): TimelinePackGate {
  return { gateIndex, layer, controls: [control], targets: [target], isNoise: false, isDetector: false, isObservable: false };
}
const rows = (qubits: number[]): Map<number, number> => new Map(qubits.map((q, i) => [q, i]));

describe('timelineColumnLayout', () => {
  it('keeps disjoint gates of one tick in a single sub-column', () => {
    const gates = [cx(0, 0, 0, 1), cx(1, 0, 2, 3)];
    const layout = timelineColumnLayout(gates, 1, rows([0, 1, 2, 3]), OPTS);
    expect(layout.subCounts).toEqual([1]);
    expect(layout.subColumnOf.get(0)).toBe(0);
    expect(layout.subColumnOf.get(1)).toBe(0);
  });

  it('splits parallel CNOTs whose row spans interleave into separate sub-columns', () => {
    // 2->1, 16->15 and 8->14 style spans: rows 0-1, 2-3 are disjoint but 0-3 crosses both.
    const gates = [cx(0, 0, 0, 3), cx(1, 0, 1, 2), cx(2, 0, 4, 5)];
    const layout = timelineColumnLayout(gates, 1, rows([0, 1, 2, 3, 4, 5]), OPTS);
    expect(layout.subColumnOf.get(0)).toBe(0);
    expect(layout.subColumnOf.get(1)).toBe(1);
    expect(layout.subColumnOf.get(2)).toBe(0);
    expect(layout.subCounts).toEqual([2]);
  });

  it('never gives two overlapping gates the same x', () => {
    const gates = [cx(0, 0, 0, 5), cx(1, 0, 1, 4), cx(2, 0, 2, 3)];
    const layout = timelineColumnLayout(gates, 1, rows([0, 1, 2, 3, 4, 5]), OPTS);
    const xs = gates.map((g) => subColumnCentre(layout, 0, layout.subColumnOf.get(g.gateIndex) ?? 0, OPTS.subColumnPx));
    expect(new Set(xs).size).toBe(3);
  });

  it('widens only the layers that need it and lays layers out without gaps', () => {
    const gates = [cx(0, 1, 0, 3), cx(1, 1, 1, 2)];
    const layout = timelineColumnLayout(gates, 3, rows([0, 1, 2, 3]), OPTS);
    expect(layout.layerWidthPx).toEqual([34, 56, 34]);
    expect(layout.layerStartPx).toEqual([0, 34, 90]);
    expect(layout.totalWidthPx).toBe(124);
  });

  it('ignores noise and detector records', () => {
    const noise: TimelinePackGate = { gateIndex: 0, layer: 0, targets: [0], isNoise: true, isDetector: false, isObservable: false };
    const layout = timelineColumnLayout([noise], 1, rows([0]), OPTS);
    expect(layout.subColumnOf.size).toBe(0);
  });
});
