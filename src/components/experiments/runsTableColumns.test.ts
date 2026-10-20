import { describe, expect, it } from 'vitest';
import {
  columnDecimals, columnDisplayLabel, deriveColumns, filterByStatus, formatRunLabel, getRunValue, isNumericColumn, metricLabel, sortRuns, sweepAxesSummary,
} from './runsTableColumns';
import type { RunManifest, RunRecord } from '../../types/experiment';

function manifest(overrides: Partial<RunManifest>): RunManifest {
  return {
    schema: 1,
    experiment: 'theta-sweep',
    point_index: 0,
    params: { theta: 0 },
    seed: 42,
    seed_honored: true,
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 100,
    language: 'python',
    entry: 'run.py',
    code_sha256: 'abc',
    git: null,
    versions: { nuclei: '0.6.0' },
    started_at: '2026-07-12T14:15:30Z',
    duration_ms: 10,
    status: 'complete',
    error: null,
    ...overrides,
  };
}

function record(dir: string, manifestOverrides: Partial<RunManifest>, metrics: Record<string, number> = {}): RunRecord {
  return { dir, manifest: manifest(manifestOverrides), metrics };
}

const RUNS: RunRecord[] = [
  record('run-a', { point_index: 0, params: { theta: 2 }, duration_ms: 50, status: 'complete' }, { energy: -1.5 }),
  record('run-b', { point_index: 1, params: { theta: 0 }, duration_ms: 10, status: 'failed' }, { energy: -0.5 }),
  record('run-c', { point_index: 2, params: { theta: 1 }, duration_ms: 30, status: 'complete' }, { energy: -2.0 }),
];

describe('deriveColumns', () => {
  it('derives param columns (first-seen order), fixed fields, then sorted metric columns', () => {
    const columns = deriveColumns(RUNS);
    const keys = columns.map((c) => c.key);
    expect(keys.slice(0, 1)).toEqual(['theta']);
    expect(keys).toContain('status');
    expect(keys).toContain('duration_ms');
    expect(keys).toContain('seed');
    expect(keys).toContain('seed_honored');
    expect(keys[keys.length - 1]).toBe('energy');
  });

  it('unions param/metric names across heterogeneous runs without duplicates', () => {
    const runs = [
      record('r1', { params: { theta: 1 } }, { energy: -1 }),
      record('r2', { params: { theta: 2, layers: 3 } }, { top_state_probability: 0.9 }),
    ];
    const keys = deriveColumns(runs).map((c) => c.key);
    expect(keys.filter((k) => k === 'theta')).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(['theta', 'layers', 'energy', 'top_state_probability']));
  });
});

describe('getRunValue', () => {
  it('reads param, field, and metric values', () => {
    const columns = deriveColumns(RUNS);
    const theta = columns.find((c) => c.key === 'theta')!;
    const status = columns.find((c) => c.key === 'status')!;
    const energy = columns.find((c) => c.key === 'energy')!;
    expect(getRunValue(RUNS[0], theta)).toBe(2);
    expect(getRunValue(RUNS[0], status)).toBe('complete');
    expect(getRunValue(RUNS[0], energy)).toBe(-1.5);
  });

  it('returns null for a metric a given run never recorded', () => {
    const columns = deriveColumns(RUNS);
    const energy = columns.find((c) => c.key === 'energy')!;
    const runWithoutEnergy = record('r-none', {}, {});
    expect(getRunValue(runWithoutEnergy, energy)).toBeNull();
  });
});

describe('sortRuns', () => {
  it('sorts ascending/descending by a swept-param column', () => {
    const columns = deriveColumns(RUNS);
    const theta = columns.find((c) => c.key === 'theta')!;
    const asc = sortRuns(RUNS, theta, 'asc').map((r) => r.dir);
    expect(asc).toEqual(['run-b', 'run-c', 'run-a']);
    const desc = sortRuns(RUNS, theta, 'desc').map((r) => r.dir);
    expect(desc).toEqual(['run-a', 'run-c', 'run-b']);
  });

  it('sorts ascending/descending by a metric column', () => {
    const columns = deriveColumns(RUNS);
    const energy = columns.find((c) => c.key === 'energy')!;
    const asc = sortRuns(RUNS, energy, 'asc').map((r) => r.dir);
    expect(asc).toEqual(['run-c', 'run-a', 'run-b']); // -2.0, -1.5, -0.5
  });

  it('never mutates the input array', () => {
    const columns = deriveColumns(RUNS);
    const theta = columns.find((c) => c.key === 'theta')!;
    const original = [...RUNS];
    sortRuns(RUNS, theta, 'asc');
    expect(RUNS).toEqual(original);
  });
});

describe('filterByStatus', () => {
  it('returns everything for "all"', () => {
    expect(filterByStatus(RUNS, 'all')).toHaveLength(3);
  });

  it('filters down to a single status', () => {
    const failed = filterByStatus(RUNS, 'failed');
    expect(failed.map((r) => r.dir)).toEqual(['run-b']);
  });
});

describe('columnDecimals', () => {
  it('uses the max decimals needed across rows, capped at 4', () => {
    const runs = [
      record('a', { params: { theta: 6.2 } }),
      record('b', { params: { theta: 6 } }),
      record('c', { params: { theta: 5.123456 } }),
    ];
    const theta = deriveColumns(runs)[0];
    expect(columnDecimals(runs, theta)).toBe(4);
    expect(columnDecimals(runs.slice(0, 2), theta)).toBe(1);
  });

  it('is 0 for an all-integer column', () => {
    const runs = [record('a', { params: { theta: 1 } }), record('b', { params: { theta: 2 } })];
    expect(columnDecimals(runs, deriveColumns(runs)[0])).toBe(0);
  });
});

describe('formatRunLabel', () => {
  it('renders timestamped run dirs as date, time and short id', () => {
    const started = new Date(2026, 9, 15, 8, 21, 50).toISOString();
    expect(formatRunLabel('20261015-142150-a458', started)).toBe('Oct 15 08:21:50 · a458');
  });

  it('treats the dir timestamp as UTC when no start time is given', () => {
    const d = new Date(Date.UTC(2026, 9, 15, 14, 21, 50));
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(formatRunLabel('20261015-142150-a458')).toBe(
      `Oct ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · a458`,
    );
  });

  it('falls back to the raw dir name for other shapes', () => {
    expect(formatRunLabel('run-a')).toBe('run-a');
  });
});

describe('isNumericColumn', () => {
  it('right-aligns params, metrics and numeric fields but not status or seed_honored', () => {
    expect(isNumericColumn({ key: 'theta', label: 'theta', kind: 'param' })).toBe(true);
    expect(isNumericColumn({ key: 'duration_ms', label: 'd', kind: 'field' })).toBe(true);
    expect(isNumericColumn({ key: 'status', label: 's', kind: 'field' })).toBe(false);
    expect(isNumericColumn({ key: 'seed_honored', label: 's', kind: 'field' })).toBe(false);
  });
});

describe('metricLabel', () => {
  it('spells every metric one way: sentence case, spaces for underscores', () => {
    expect(metricLabel('counts_entropy')).toBe('Counts entropy');
    expect(metricLabel('top_state_probability')).toBe('Top state probability');
    expect(metricLabel('energy')).toBe('Energy');
    expect(metricLabel('fidelity')).toBe('Fidelity');
  });
});

describe('columnDisplayLabel', () => {
  it('labels metrics with metricLabel, keeps swept parameters verbatim and fixed fields as authored', () => {
    expect(columnDisplayLabel({ key: 'counts_entropy', label: 'counts_entropy', kind: 'metric' })).toBe('Counts entropy');
    expect(columnDisplayLabel({ key: 'max_depth', label: 'max_depth', kind: 'param' })).toBe('max_depth');
    expect(columnDisplayLabel({ key: 'status', label: 'Status', kind: 'field' })).toBe('Status');
  });
});

describe('deriveColumns with a declared sweep', () => {
  it('shows a swept parameter column before any run exists', () => {
    const cols = deriveColumns([], ['depth']);
    expect(cols[0]).toEqual({ key: 'depth', label: 'depth', kind: 'param' });
  });

  it('does not duplicate a declared parameter once runs carry it', () => {
    const cols = deriveColumns([record('a', { params: { depth: 2 } })], ['depth']);
    expect(cols.filter((c) => c.key === 'depth')).toHaveLength(1);
  });
});

describe('sweepAxesSummary', () => {
  it('lists each swept parameter with its value count', () => {
    expect(sweepAxesSummary({ depth: { values: [1, 2, 3, 4] }, theta: { range: [0, 1, 0.5] } } as never)).toBe('depth × 4, theta × 3');
  });
  it('is empty without a sweep', () => {
    expect(sweepAxesSummary(undefined)).toBe('');
  });
});
