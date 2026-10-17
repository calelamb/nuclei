import { describe, expect, it } from 'vitest';
import { buildSweepSeries, findFailedMarkers, hasRepeatedX, pickDefaultMetric, splitAtFailures } from './sweepPlot';
import type { RunManifest, RunRecord } from '../types/experiment';

function manifest(overrides: Partial<RunManifest>): RunManifest {
  return {
    schema: 1,
    experiment: 'theta-sweep',
    point_index: 0,
    params: {},
    seed: 42,
    seed_honored: true,
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 1024,
    language: 'python',
    entry: 'vqe.py',
    code_sha256: 'abc',
    git: null,
    versions: { nuclei: '0.6.0' },
    started_at: '2026-07-12T14:15:30Z',
    duration_ms: 100,
    status: 'complete',
    error: null,
    ...overrides,
  };
}

function record(
  dir: string,
  params: Record<string, number>,
  metrics: Record<string, number>,
  status: RunManifest['status'] = 'complete',
): RunRecord {
  return { dir, manifest: manifest({ params, status }), metrics };
}

describe('buildSweepSeries', () => {
  it('1-D grid: bins into a single series sorted ascending by x', () => {
    const runs = [
      record('r2', { theta: 2 }, { energy: -0.5 }),
      record('r0', { theta: 0 }, { energy: -1.0 }),
      record('r1', { theta: 1 }, { energy: -1.5 }),
    ];
    const series = buildSweepSeries(runs, 'theta', 'energy');
    expect(series).toHaveLength(1);
    expect(series[0].group).toBeNull();
    expect(series[0].points).toEqual([
      { x: 0, y: -1.0, dir: 'r0' },
      { x: 1, y: -1.5, dir: 'r1' },
      { x: 2, y: -0.5, dir: 'r2' },
    ]);
  });

  it('2-D grid: one sorted series per group value', () => {
    const runs = [
      record('a', { theta: 0, layers: 2 }, { energy: -1 }),
      record('b', { theta: 1, layers: 2 }, { energy: -2 }),
      record('c', { theta: 0, layers: 1 }, { energy: -0.1 }),
      record('d', { theta: 1, layers: 1 }, { energy: -0.2 }),
    ];
    const series = buildSweepSeries(runs, 'theta', 'energy', 'layers');
    expect(series.map((s) => s.group)).toEqual(['1', '2']);
    const layer1 = series.find((s) => s.group === '1')!;
    expect(layer1.points).toEqual([
      { x: 0, y: -0.1, dir: 'c' },
      { x: 1, y: -0.2, dir: 'd' },
    ]);
    const layer2 = series.find((s) => s.group === '2')!;
    expect(layer2.points).toEqual([
      { x: 0, y: -1, dir: 'a' },
      { x: 1, y: -2, dir: 'b' },
    ]);
  });

  it('sorts group keys numerically, not lexicographically (2 before 10)', () => {
    const runs = [
      record('a', { theta: 0, layers: 10 }, { energy: -1 }),
      record('b', { theta: 0, layers: 2 }, { energy: -2 }),
    ];
    const series = buildSweepSeries(runs, 'theta', 'energy', 'layers');
    expect(series.map((s) => s.group)).toEqual(['2', '10']);
  });

  it('skips failed/stale/running runs', () => {
    const runs = [
      record('ok', { theta: 0 }, { energy: -1 }, 'complete'),
      record('bad', { theta: 1 }, { energy: -2 }, 'failed'),
      record('stale', { theta: 2 }, { energy: -3 }, 'stale'),
      record('running', { theta: 3 }, { energy: -4 }, 'running'),
    ];
    const series = buildSweepSeries(runs, 'theta', 'energy');
    expect(series[0].points).toEqual([{ x: 0, y: -1, dir: 'ok' }]);
  });

  it('skips a run missing the requested metric without breaking the rest', () => {
    const runs = [
      record('ok', { theta: 0 }, { energy: -1 }),
      record('missing-metric', { theta: 1 }, {}),
      record('ok2', { theta: 2 }, { energy: -3 }),
    ];
    const series = buildSweepSeries(runs, 'theta', 'energy');
    expect(series[0].points.map((p) => p.dir)).toEqual(['ok', 'ok2']);
  });

  it('skips a run missing the requested param without breaking the rest', () => {
    const runs = [
      record('ok', { theta: 0 }, { energy: -1 }),
      record('missing-param', { other: 5 }, { energy: -2 }),
    ];
    const series = buildSweepSeries(runs, 'theta', 'energy');
    expect(series[0].points).toEqual([{ x: 0, y: -1, dir: 'ok' }]);
  });

  it('unknown xParam yields an empty (1-D) series rather than throwing', () => {
    const runs = [record('a', { theta: 0 }, { energy: -1 })];
    const series = buildSweepSeries(runs, 'nonexistent_param', 'energy');
    expect(series).toEqual([{ group: null, points: [] }]);
  });

  it('unknown yMetric yields an empty (1-D) series rather than throwing', () => {
    const runs = [record('a', { theta: 0 }, { energy: -1 })];
    const series = buildSweepSeries(runs, 'theta', 'nonexistent_metric');
    expect(series).toEqual([{ group: null, points: [] }]);
  });

  it('unknown groupParam yields no series at all (grouped case)', () => {
    const runs = [record('a', { theta: 0 }, { energy: -1 })];
    const series = buildSweepSeries(runs, 'theta', 'energy', 'nonexistent_group');
    expect(series).toEqual([]);
  });

  it('empty runs list yields an empty (1-D) series', () => {
    expect(buildSweepSeries([], 'theta', 'energy')).toEqual([{ group: null, points: [] }]);
  });
});

describe('hasRepeatedX', () => {
  it('detects points that share an x (an ungrouped 2-param sweep)', () => {
    expect(hasRepeatedX([{ x: 1, y: 0, dir: 'a' }, { x: 1, y: 2, dir: 'b' }])).toBe(true);
    expect(hasRepeatedX([{ x: 1, y: 0, dir: 'a' }, { x: 2, y: 2, dir: 'b' }])).toBe(false);
  });
});

describe('findFailedMarkers', () => {
  it('collects failed runs per group so the plot can show them instead of bridging silently', () => {
    const runs = [
      record('ok', { theta: 1, depth: 3 }, { energy: -1 }),
      record('bad', { theta: 3, depth: 3 }, {}, 'failed'),
      record('bad2', { theta: 3, depth: 1 }, {}, 'failed'),
    ];
    const markers = findFailedMarkers(runs, 'theta', 'depth');
    expect(markers.get('3')).toEqual([{ x: 3, dir: 'bad' }]);
    expect(markers.get('1')).toEqual([{ x: 3, dir: 'bad2' }]);
  });

  it('uses the empty-string group when ungrouped', () => {
    const markers = findFailedMarkers([record('bad', { theta: 3 }, {}, 'failed')], 'theta');
    expect(markers.get('')).toEqual([{ x: 3, dir: 'bad' }]);
  });
});

describe('splitAtFailures', () => {
  const pts = [1, 2, 4, 5].map((x) => ({ x, y: x, dir: `r${x}` }));
  it('breaks the line where a failed x sits between two points', () => {
    const segments = splitAtFailures(pts, [3]);
    expect(segments.map((s) => s.map((p) => p.x))).toEqual([[1, 2], [4, 5]]);
  });
  it('keeps one segment without failures', () => {
    expect(splitAtFailures(pts, [])).toHaveLength(1);
  });
});

describe('pickDefaultMetric', () => {
  it('prefers a user metric over derived count statistics', () => {
    expect(pickDefaultMetric(['counts_entropy', 'energy', 'top_state_proba'])).toBe('energy');
    expect(pickDefaultMetric(['counts_entropy'])).toBe('counts_entropy');
    expect(pickDefaultMetric([])).toBe('');
  });
});
