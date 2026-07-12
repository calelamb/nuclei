import { describe, expect, it } from 'vitest';
import { deriveColumns, filterByStatus, getRunValue, sortRuns } from './runsTableColumns';
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
