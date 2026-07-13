import { describe, expect, it } from 'vitest';
import {
  computeDerivedMetrics,
  countsEntropy,
  expandGrid,
  expandRange,
  GridExpansionError,
  isValidParamName,
  MAX_GRID_POINTS,
  parseExperimentYaml,
  runManifestSchema,
  runRecordSchema,
  topStateProbability,
  type RunManifest,
  campaignManifestSchema,
  campaignRoundsSchema,
  campaignTaskCount,
  resolveRounds,
} from './experiment';

// ---------------------------------------------------------------------------
// expandRange — numpy.arange + epsilon
// ---------------------------------------------------------------------------

describe('expandRange', () => {
  it('expands a simple range excluding a non-multiple stop', () => {
    // 1 is not a multiple of 0.3 -> arange behavior, stop excluded.
    expect(expandRange([0, 1, 0.3])).toEqual([0, 0.3, 0.6, 0.8999999999999999]);
  });

  it('includes the stop when it is an exact multiple of step (epsilon boundary)', () => {
    const values = expandRange([0, 1, 0.25]);
    expect(values).toHaveLength(5);
    expect(values[0]).toBe(0);
    expect(values[4]).toBeCloseTo(1, 10);
  });

  it('includes an integer-multiple stop for whole-number steps', () => {
    expect(expandRange([0, 4, 1])).toEqual([0, 1, 2, 3, 4]);
  });

  it('yields a single point when start === stop', () => {
    expect(expandRange([2, 2, 0.5])).toEqual([2]);
  });

  it('throws invalid_step on zero step', () => {
    try {
      expandRange([0, 1, 0], 'theta');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GridExpansionError);
      expect((e as GridExpansionError).code).toBe('invalid_step');
      expect((e as GridExpansionError).param).toBe('theta');
    }
  });

  it('throws invalid_step on negative step', () => {
    expect(() => expandRange([0, 1, -0.25])).toThrowError(GridExpansionError);
    try {
      expandRange([0, 1, -0.25]);
    } catch (e) {
      expect((e as GridExpansionError).code).toBe('invalid_step');
    }
  });

  it('throws empty_range when stop is behind start', () => {
    try {
      expandRange([5, 0, 1]);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as GridExpansionError).code).toBe('empty_range');
    }
  });
});

// ---------------------------------------------------------------------------
// expandGrid — ordering, cartesian product, cap
// ---------------------------------------------------------------------------

describe('expandGrid', () => {
  it('returns a single empty point for no sweep', () => {
    expect(expandGrid(undefined)).toEqual([{}]);
    expect(expandGrid({})).toEqual([{}]);
  });

  it('expands a 1-D range sweep', () => {
    const grid = expandGrid({ theta: { range: [0, 1, 0.25] } });
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual({ theta: 0 });
    expect(grid[4].theta).toBeCloseTo(1, 10);
  });

  it('expands a 1-D values sweep preserving order', () => {
    expect(expandGrid({ layers: { values: [1, 2, 4] } })).toEqual([
      { layers: 1 },
      { layers: 2 },
      { layers: 4 },
    ]);
  });

  it('orders a 2-D grid with the FIRST-declared param varying fastest', () => {
    const grid = expandGrid({
      theta: { values: [0, 1] },
      layers: { values: [10, 20, 30] },
    });
    // theta (first) is the inner/fast loop; layers (second) is the outer/slow.
    expect(grid).toEqual([
      { theta: 0, layers: 10 },
      { theta: 1, layers: 10 },
      { theta: 0, layers: 20 },
      { theta: 1, layers: 20 },
      { theta: 0, layers: 30 },
      { theta: 1, layers: 30 },
    ]);
  });

  it('matches the PRD manifest example: theta index 7 lands at point_index 7', () => {
    // theta: range [0, 3.14159, 0.31416] -> 10 values; layers: [1,2,4].
    const grid = expandGrid({
      theta: { range: [0, 3.14159, 0.31416] },
      layers: { values: [1, 2, 4] },
    });
    expect(grid).toHaveLength(30);
    expect(grid[7].theta).toBeCloseTo(2.19912, 4);
    expect(grid[7].layers).toBe(1); // first-declared fastest -> layers[0]
  });

  it('keeps declaration order in each point object', () => {
    const grid = expandGrid({
      alpha: { values: [1] },
      beta: { values: [2] },
    });
    expect(Object.keys(grid[0])).toEqual(['alpha', 'beta']);
  });

  it('caps at MAX_GRID_POINTS with the computed count in the error', () => {
    // 21 * 25 = 525 > 500.
    try {
      expandGrid({
        a: { values: Array.from({ length: 21 }, (_, i) => i) },
        b: { values: Array.from({ length: 25 }, (_, i) => i) },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GridExpansionError);
      expect((e as GridExpansionError).code).toBe('grid_too_large');
      expect((e as GridExpansionError).count).toBe(525);
    }
  });

  it('allows exactly MAX_GRID_POINTS', () => {
    const grid = expandGrid({ a: { range: [0, MAX_GRID_POINTS - 1, 1] } });
    expect(grid).toHaveLength(MAX_GRID_POINTS);
  });
});

// ---------------------------------------------------------------------------
// isValidParamName
// ---------------------------------------------------------------------------

describe('isValidParamName', () => {
  it('accepts valid identifiers', () => {
    expect(isValidParamName('theta')).toBe(true);
    expect(isValidParamName('_x')).toBe(true);
    expect(isValidParamName('layer_2')).toBe(true);
  });

  it('rejects invalid identifiers and keywords', () => {
    expect(isValidParamName('2theta')).toBe(false);
    expect(isValidParamName('a-b')).toBe(false);
    expect(isValidParamName('class')).toBe(false);
    expect(isValidParamName('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseExperimentYaml
// ---------------------------------------------------------------------------

const FULL_YAML = `
schema: 1
name: theta-sweep
entry: vqe_h2.py
language: python
backend:
  provider: simulator
  target: statevector
shots: 2048
seed: 42
sweep:
  theta:
    range: [0, 3.14159, 0.31416]
  layers:
    values: [1, 2, 4]
notes: angle sweep
`;

describe('parseExperimentYaml', () => {
  it('parses a full valid experiment', () => {
    const result = parseExperimentYaml(FULL_YAML, 'theta-sweep.experiment.yaml');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.name).toBe('theta-sweep');
      expect(result.spec.shots).toBe(2048);
      expect(result.spec.backend.provider).toBe('simulator');
      expect(result.spec.sweep?.theta).toEqual({ range: [0, 3.14159, 0.31416] });
    }
  });

  it('defaults name from the filename when omitted', () => {
    const yaml = 'schema: 1\nentry: bell.py\nbackend:\n  provider: simulator\n  target: statevector\nshots: 100\nseed: 0\n';
    const result = parseExperimentYaml(yaml, 'my-run.experiment.yaml');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.name).toBe('my-run');
  });

  it('infers language qsharp from a .qs entry', () => {
    const yaml = 'schema: 1\nentry: Main.qs\nbackend:\n  provider: simulator\n  target: statevector\nshots: 100\nseed: 0\n';
    const result = parseExperimentYaml(yaml, 'q.experiment.yaml');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.language).toBe('qsharp');
  });

  it('defaults language to python for non-.qs entries', () => {
    const yaml = 'schema: 1\nentry: run.py\nbackend:\n  provider: simulator\n  target: statevector\nshots: 100\nseed: 0\n';
    const result = parseExperimentYaml(yaml, 'p.experiment.yaml');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.language).toBe('python');
  });

  it('rejects schema !== 1', () => {
    const yaml = 'schema: 2\nentry: a.py\nbackend:\n  provider: simulator\n  target: statevector\nshots: 1\nseed: 0\n';
    const result = parseExperimentYaml(yaml, 'x.experiment.yaml');
    expect(result.ok).toBe(false);
  });

  it('surfaces malformed YAML as errors, never throwing', () => {
    const result = parseExperimentYaml('schema: 1\n  bad: : :', 'bad.experiment.yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/YAML parse error/);
  });

  it('rejects a non-mapping document', () => {
    const result = parseExperimentYaml('- 1\n- 2\n', 'list.experiment.yaml');
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid parameter name', () => {
    const yaml = `schema: 1
entry: a.py
backend:
  provider: simulator
  target: statevector
shots: 1
seed: 0
sweep:
  "bad-name":
    values: [1, 2]
`;
    const result = parseExperimentYaml(yaml, 'x.experiment.yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /valid Python identifier/.test(e))).toBe(true);
  });

  it('surfaces an oversized grid at parse time with the count', () => {
    const yaml = `schema: 1
entry: a.py
backend:
  provider: simulator
  target: statevector
shots: 1
seed: 0
sweep:
  a:
    range: [0, 30, 1]
  b:
    range: [0, 30, 1]
`;
    const result = parseExperimentYaml(yaml, 'big.experiment.yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /exceeds the v1 cap/.test(e))).toBe(true);
  });

  it('rejects a sweep param carrying both range and values', () => {
    const yaml = `schema: 1
entry: a.py
backend:
  provider: simulator
  target: statevector
shots: 1
seed: 0
sweep:
  theta:
    range: [0, 1, 0.5]
    values: [1, 2]
`;
    const result = parseExperimentYaml(yaml, 'x.experiment.yaml');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

describe('derived metrics', () => {
  it('computes zero entropy for a determinate distribution', () => {
    expect(countsEntropy({ '00': 1000 })).toBe(0);
  });

  it('computes 1 bit entropy for a fair two-outcome distribution', () => {
    expect(countsEntropy({ '00': 500, '11': 500 })).toBeCloseTo(1, 10);
  });

  it('computes 2 bits for four equally-likely outcomes', () => {
    expect(countsEntropy({ a: 1, b: 1, c: 1, d: 1 })).toBeCloseTo(2, 10);
  });

  it('handles empty measurements', () => {
    expect(countsEntropy({})).toBe(0);
    expect(topStateProbability({})).toBe(0);
  });

  it('computes top state probability', () => {
    expect(topStateProbability({ '00': 750, '11': 250 })).toBeCloseTo(0.75, 10);
  });

  it('bundles both derived metrics', () => {
    const m = computeDerivedMetrics({ '00': 500, '11': 500 });
    expect(m.counts_entropy).toBeCloseTo(1, 10);
    expect(m.top_state_probability).toBeCloseTo(0.5, 10);
  });
});

// ---------------------------------------------------------------------------
// Manifest / record schema round-trips
// ---------------------------------------------------------------------------

const VALID_MANIFEST: RunManifest = {
  schema: 1,
  experiment: 'theta-sweep',
  point_index: 7,
  params: { theta: 2.19911, layers: 2 },
  seed: 49,
  seed_honored: true,
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 2048,
  language: 'python',
  entry: 'vqe_h2.py',
  code_sha256: 'abc123',
  git: { commit: 'deadbeef', dirty: true },
  versions: { nuclei: '0.6.0', python: '3.12.4', qiskit: '1.4.1' },
  started_at: '2026-07-12T14:15:30Z',
  duration_ms: 1834,
  status: 'complete',
  error: null,
};

describe('runManifestSchema', () => {
  it('accepts a PRD-shaped manifest', () => {
    expect(runManifestSchema.safeParse(VALID_MANIFEST).success).toBe(true);
  });

  it('accepts a null git block', () => {
    expect(runManifestSchema.safeParse({ ...VALID_MANIFEST, git: null }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      runManifestSchema.safeParse({ ...VALID_MANIFEST, status: 'weird' }).success,
    ).toBe(false);
  });

  it('rejects a wrong schema version', () => {
    expect(runManifestSchema.safeParse({ ...VALID_MANIFEST, schema: 2 }).success).toBe(false);
  });

  it('validates a full RunRecord', () => {
    const record = { dir: '20260712-141530-a3f9', manifest: VALID_MANIFEST, metrics: { energy: -1.1 } };
    expect(runRecordSchema.safeParse(record).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema v2 (PRD 10 Phase C): back-compat + qec_campaign
// ---------------------------------------------------------------------------

const V1_ON_DISK = `
schema: 1
name: theta-sweep
entry: vqe_h2.py
backend:
  provider: simulator
  target: statevector
shots: 2048
seed: 42
sweep:
  theta:
    range: [0, 3.14159, 0.31416]
`;

const V2_CAMPAIGN = `
schema: 2
type: qec_campaign
name: surface-vs-repetition
source:
  generate:
    code: surface_code:rotated_memory_z
    distances: [3, 5, 7]
    rounds: 3d
noise:
  model: SI1000
  p: { range: [0.001, 0.01, 0.001] }
decoders: [pymatching, fusion_blossom]
collect:
  max_shots: 1000000
  max_errors: 1000
workers: auto
`;

describe('schema v2 (PRD 10 Phase C)', () => {
  it('BACK-COMPAT: a schema-1 file (no type key) parses exactly as before, normalized to type sweep', () => {
    const result = parseExperimentYaml(V1_ON_DISK, 'theta-sweep.experiment.yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec).toEqual({
      schema: 1,
      type: 'sweep',
      name: 'theta-sweep',
      entry: 'vqe_h2.py',
      language: 'python',
      backend: { provider: 'simulator', target: 'statevector' },
      shots: 2048,
      seed: 42,
      sweep: { theta: { range: [0, 3.14159, 0.31416] } },
    });
  });

  it('schema-2 type sweep validates with identical semantics', () => {
    const result = parseExperimentYaml(
      V1_ON_DISK.replace('schema: 1', 'schema: 2\ntype: sweep'),
      'theta-sweep.experiment.yaml',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.type).toBe('sweep');
    if (result.spec.type !== 'sweep') return;
    // 3.14159 is NOT an exact multiple of 0.31416 (9.99997...), so the
    // arange-with-epsilon stops at 2.82744 — 10 points, same as v1.
    expect(expandGrid(result.spec.sweep)).toHaveLength(10);
  });

  it('parses a full qec_campaign spec', () => {
    const result = parseExperimentYaml(V2_CAMPAIGN, 'surface-vs-repetition.experiment.yaml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.type).toBe('qec_campaign');
    if (result.spec.type !== 'qec_campaign') return;
    expect(result.spec.decoders).toEqual(['pymatching', 'fusion_blossom']);
    expect(result.spec.workers).toBe('auto');
    // grid: 3 distances x 10 noise points x 2 decoders
    expect(campaignTaskCount(result.spec)).toBe(60);
  });

  it('campaign task count is null for entry sources (labels unknown until materialization)', () => {
    const yaml = V2_CAMPAIGN.replace(
      /source:[\s\S]*?rounds: 3d\n/,
      'source:\n  entry: make_circuits.py\n',
    );
    const result = parseExperimentYaml(yaml, 'c.experiment.yaml');
    expect(result.ok).toBe(true);
    if (!result.ok || result.spec.type !== 'qec_campaign') return;
    expect(campaignTaskCount(result.spec)).toBeNull();
  });

  it('rejects a campaign seed with the honest sinter explanation', () => {
    const result = parseExperimentYaml(V2_CAMPAIGN + 'seed: 42\n', 'c.experiment.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/not seed-reproducible/);
  });

  it('requires a collection bound', () => {
    const yaml = V2_CAMPAIGN.replace(/collect:[\s\S]*?max_errors: 1000\n/, 'collect: {}\n');
    const result = parseExperimentYaml(yaml, 'c.experiment.yaml');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/max_shots \/ max_errors/);
  });

  it('schema 2 without a type is a readable error', () => {
    const result = parseExperimentYaml(
      V1_ON_DISK.replace('schema: 1', 'schema: 2'),
      't.experiment.yaml',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/explicit type/);
  });

  it('qec_campaign under schema 1 is a readable error', () => {
    const result = parseExperimentYaml(
      V2_CAMPAIGN.replace('schema: 2', 'schema: 1'),
      'c.experiment.yaml',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/requires schema: 2/);
  });

  it('resolveRounds handles integers and "<n>d"', () => {
    expect(resolveRounds(7, 5)).toBe(7);
    expect(resolveRounds('3d', 5)).toBe(15);
    expect(campaignRoundsSchema.safeParse('0d').success).toBe(false);
    expect(campaignRoundsSchema.safeParse('d3').success).toBe(false);
  });

  it('campaignManifestSchema accepts a complete campaign manifest', () => {
    const manifest = {
      schema: 1,
      type: 'qec_campaign',
      experiment: 'surface-vs-repetition',
      source: { generate: { code: 'surface_code:rotated_memory_z', distances: [3, 5], rounds: '3d' } },
      noise_model: 'SI1000',
      noise_points: [0.001, 0.002],
      decoders: ['pymatching'],
      tasks_total: 4,
      collect: { max_shots: 1000 },
      workers: 'auto',
      code_sha256: 'abc123',
      git: null,
      versions: { nuclei: '0.7.0', stim: '1.16.0', sinter: '1.16.0' },
      started_at: '2026-07-12T00:00:00.000Z',
      duration_ms: 1234,
      status: 'complete',
      partial: false,
      sampled_shots: 4000,
      resumed_from: null,
      error: null,
    };
    const parsed = campaignManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });
});
