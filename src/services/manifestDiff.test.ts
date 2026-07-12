import { describe, expect, it } from 'vitest';
import { diffManifests } from './manifestDiff';
import type { RunManifest } from '../types/experiment';

function manifest(overrides: Partial<RunManifest>): RunManifest {
  return {
    schema: 1,
    experiment: 'theta-sweep',
    point_index: 0,
    params: { theta: 0 },
    seed: 42,
    seed_honored: true,
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 1024,
    language: 'python',
    entry: 'vqe.py',
    code_sha256: 'abc123',
    git: { commit: 'deadbeef', dirty: false },
    versions: { nuclei: '0.6.0', qiskit: '1.4.1' },
    started_at: '2026-07-12T14:15:30Z',
    duration_ms: 100,
    status: 'complete',
    error: null,
    ...overrides,
  };
}

describe('diffManifests', () => {
  it('reports every field as identical when manifests are identical', () => {
    const a = manifest({});
    const b = manifest({});
    const result = diffManifests([a, b]);
    expect(result.differing).toEqual([]);
    expect(result.identical.length).toBeGreaterThan(0);
    expect(result.identical.some((f) => f.key === 'params.theta' && f.value === 0)).toBe(true);
  });

  it('flags a differing swept param and leaves everything else identical', () => {
    const a = manifest({ params: { theta: 0 }, point_index: 0 });
    const b = manifest({ params: { theta: 1 }, point_index: 1 });
    const result = diffManifests([a, b]);
    const keys = result.differing.map((f) => f.key).sort();
    expect(keys).toEqual(['params.theta', 'point_index']);
    const thetaField = result.differing.find((f) => f.key === 'params.theta')!;
    expect(thetaField.values).toEqual([0, 1]);
    expect(result.identical.some((f) => f.key === 'seed')).toBe(true);
  });

  it('flags a differing seed', () => {
    const a = manifest({ seed: 42 });
    const b = manifest({ seed: 43 });
    const result = diffManifests([a, b]);
    expect(result.differing.some((f) => f.key === 'seed')).toBe(true);
  });

  it('flags differing version keys, including a version present in only one run', () => {
    const a = manifest({ versions: { nuclei: '0.6.0', qiskit: '1.4.1' } });
    const b = manifest({ versions: { nuclei: '0.6.0', qiskit: '1.5.0' } });
    const c = manifest({ versions: { nuclei: '0.6.0', cirq: '1.4.0' } });
    const result = diffManifests([a, b, c]);
    const qiskitField = result.differing.find((f) => f.key === 'versions.qiskit');
    expect(qiskitField?.values).toEqual(['1.4.1', '1.5.0', undefined]);
    const cirqField = result.differing.find((f) => f.key === 'versions.cirq');
    expect(cirqField?.values).toEqual([undefined, undefined, '1.4.0']);
    expect(result.identical.some((f) => f.key === 'versions.nuclei')).toBe(true);
  });

  it('flags a dirty git tree difference and a null-vs-repo difference', () => {
    const a = manifest({ git: { commit: 'abc', dirty: false } });
    const b = manifest({ git: null });
    const result = diffManifests([a, b]);
    expect(result.differing.some((f) => f.key === 'git.commit')).toBe(true);
    expect(result.differing.some((f) => f.key === 'git.dirty')).toBe(true);
  });

  it('treats a single manifest as having no differences', () => {
    const result = diffManifests([manifest({})]);
    expect(result.differing).toEqual([]);
    expect(result.identical.length).toBeGreaterThan(0);
  });

  it('returns empty diff for zero manifests', () => {
    expect(diffManifests([])).toEqual({ differing: [], identical: [] });
  });
});
