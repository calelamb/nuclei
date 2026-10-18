import { describe, expect, it } from 'vitest';
import { buildHeatmapModel, DEAD_VARIANCE, resolveGateIndex } from './heatmapMath';
import { gradientsFixture, inspectionFixture } from '../../services/trainability/fixtures';
import type { Gate } from '../../types/quantum';

const gate = (type: string, layer: number, symbol: string | null, target = 0): Gate => ({
  type,
  targets: [target],
  controls: [],
  params: [0],
  layer,
  symbols: [symbol],
});

// 9 gates, indices 0-3 and 7-8 are RY, 4-6 CZ (matches inspectionFixture).
const gates: Gate[] = [
  ...[0, 1, 2, 3].map((q) => gate('RY', 0, `θ[${q}]`, q)),
  ...[0, 1, 2].map((q) => ({ type: 'CZ', targets: [q + 1], controls: [q], params: [], layer: 1 + q })),
  gate('RY', 4, 'θ[4]', 0),
  gate('RY', 4, 'θ[5]', 1),
];

describe('buildHeatmapModel', () => {
  it('maps overlays by source_index and tints on a log ramp', () => {
    const model = buildHeatmapModel(gates, inspectionFixture, gradientsFixture);
    expect(model.overlays).toHaveLength(6);
    expect(model.byGateIndex.get(0)?.parameter).toBe('θ[0]');
    expect(model.byGateIndex.get(7)?.parameter).toBe('θ[4]');
    const top = model.byGateIndex.get(0)!;
    const lower = model.byGateIndex.get(3)!;
    expect(top.t).toBe(1);
    expect(lower.t).toBeLessThan(top.t!);
  });

  it('marks zero-variance gates dead with no tint', () => {
    const model = buildHeatmapModel(gates, inspectionFixture, gradientsFixture);
    const dead = model.byGateIndex.get(8)!;
    expect(dead.dead).toBe(true);
    expect(dead.t).toBeNull();
    expect(model.deadCount).toBe(1);
    expect(DEAD_VARIANCE).toBe(1e-8);
  });

  it('shows untinted outlines before any gradient result exists', () => {
    const model = buildHeatmapModel(gates, inspectionFixture, undefined);
    expect(model.overlays).toHaveLength(6);
    expect(model.measuredCount).toBe(0);
    expect(model.domain).toBeNull();
    expect(model.overlays.every((o) => o.t === null && !o.dead)).toBe(true);
  });

  it('falls back to the k-th symbolic gate when the source index points elsewhere', () => {
    const shifted = [gate('H', 0, null), ...gates];
    expect(resolveGateIndex(shifted, { source_index: 0, gate: 'RY' }, 0, [1, 2, 3, 4])).toBe(1);
    expect(resolveGateIndex(shifted, { source_index: 0, gate: 'RY' }, 9, [1])).toBeNull();
  });

  it('does not mutate its inputs', () => {
    const frozen = Object.freeze(gates.map((g) => Object.freeze({ ...g })));
    expect(() => buildHeatmapModel(frozen, inspectionFixture, gradientsFixture)).not.toThrow();
  });

  it('handles a single measured value (degenerate domain)', () => {
    const one = { ...gradientsFixture, gate_values: [gradientsFixture.gate_values[0]] };
    expect(buildHeatmapModel(gates, inspectionFixture, one).byGateIndex.get(0)?.t).toBe(0.5);
  });
});
