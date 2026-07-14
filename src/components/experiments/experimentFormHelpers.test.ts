import { describe, expect, it } from 'vitest';
import {
  buildSweepFromRows,
  discoverEntryFiles,
  newSweepRow,
  parseNumberField,
  slugify,
  specToYamlDoc,
  sweepToRows,
  type SweepRowState,
} from './experimentFormHelpers';
import type { ExperimentSpec } from '../../types/experiment';

describe('parseNumberField', () => {
  it('parses a numeric string', () => {
    expect(parseNumberField('42')).toBe(42);
    expect(parseNumberField('  0.5 ')).toBe(0.5);
    expect(parseNumberField('0')).toBe(0);
  });

  it('returns NaN for a blank / whitespace-only field (not 0)', () => {
    // Number('') === 0 would silently coerce an empty Seed box to seed 0 and
    // pass zod's z.number().int() — NaN makes validation flag it instead.
    expect(parseNumberField('')).toBeNaN();
    expect(parseNumberField('   ')).toBeNaN();
  });

  it('returns NaN for non-numeric text', () => {
    expect(parseNumberField('abc')).toBeNaN();
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Theta Sweep!')).toBe('theta-sweep');
  });

  it('collapses runs of invalid characters and trims edges', () => {
    expect(slugify('  __weird///name__  ')).toBe('weird-name');
  });

  it('falls back to "experiment" for an empty/degenerate name', () => {
    expect(slugify('   ')).toBe('experiment');
    expect(slugify('!!!')).toBe('experiment');
  });
});

describe('buildSweepFromRows', () => {
  it('returns undefined for no named rows', () => {
    expect(buildSweepFromRows([])).toBeUndefined();
    expect(buildSweepFromRows([newSweepRow('a')])).toBeUndefined();
  });

  it('builds a range sweep param', () => {
    const row: SweepRowState = { ...newSweepRow('r1'), name: 'theta', mode: 'range', rangeStart: '0', rangeStop: '1', rangeStep: '0.5' };
    expect(buildSweepFromRows([row])).toEqual({ theta: { range: [0, 1, 0.5] } });
  });

  it('yields NaN (not 0) for a blank range bound so the schema rejects it', () => {
    const row: SweepRowState = { ...newSweepRow('r1'), name: 'theta', mode: 'range', rangeStart: '0', rangeStop: '', rangeStep: '0.5' };
    const built = buildSweepFromRows([row]);
    const range = (built?.theta as { range: number[] }).range;
    expect(range[0]).toBe(0);
    expect(range[1]).toBeNaN();
    expect(range[2]).toBe(0.5);
  });

  it('builds a values sweep param, trimming and dropping blanks', () => {
    const row: SweepRowState = { ...newSweepRow('r1'), name: 'layers', mode: 'values', valuesText: ' 1, 2,,3 ' };
    expect(buildSweepFromRows([row])).toEqual({ layers: { values: [1, 2, 3] } });
  });

  it('ignores rows with a blank name (in-progress add)', () => {
    const rows: SweepRowState[] = [
      { ...newSweepRow('r1'), name: 'theta', mode: 'values', valuesText: '1' },
      newSweepRow('r2'),
    ];
    expect(buildSweepFromRows(rows)).toEqual({ theta: { values: [1] } });
  });
});

describe('sweepToRows / buildSweepFromRows round-trip', () => {
  it('round-trips a range sweep', () => {
    const rows = sweepToRows({ theta: { range: [0, 1, 0.25] } }, () => 'id-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('theta');
    expect(rows[0].mode).toBe('range');
    expect(buildSweepFromRows(rows)).toEqual({ theta: { range: [0, 1, 0.25] } });
  });

  it('round-trips a values sweep', () => {
    const rows = sweepToRows({ layers: { values: [1, 2, 4] } }, () => 'id-2');
    expect(rows[0].mode).toBe('values');
    expect(buildSweepFromRows(rows)).toEqual({ layers: { values: [1, 2, 4] } });
  });

  it('returns an empty array for an undefined sweep', () => {
    expect(sweepToRows(undefined, () => 'x')).toEqual([]);
  });
});

describe('specToYamlDoc', () => {
  const BASE_SPEC: ExperimentSpec = {
    schema: 1,
    name: 'theta-sweep',
    entry: 'vqe_h2.py',
    language: 'python',
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 2048,
    seed: 42,
  };

  it('orders keys per the documented schema and omits absent optional fields', () => {
    const doc = specToYamlDoc(BASE_SPEC);
    expect(Object.keys(doc)).toEqual(['schema', 'name', 'entry', 'language', 'backend', 'shots', 'seed']);
    expect(doc.sweep).toBeUndefined();
    expect(doc.notes).toBeUndefined();
  });

  it('includes sweep and notes when present', () => {
    const spec: ExperimentSpec = {
      ...BASE_SPEC,
      sweep: { theta: { values: [0, 1] } },
      notes: 'H2 ansatz sweep',
    };
    const doc = specToYamlDoc(spec);
    expect(Object.keys(doc)).toEqual(['schema', 'name', 'entry', 'language', 'backend', 'shots', 'seed', 'sweep', 'notes']);
    expect(doc.sweep).toEqual({ theta: { values: [0, 1] } });
    expect(doc.notes).toBe('H2 ansatz sweep');
  });
});

describe('discoverEntryFiles', () => {
  it('collects .py/.qs files across nested directories, skipping excluded dirs', async () => {
    const tree: Record<string, Array<{ name: string; path: string; kind: 'file' | 'directory' }>> = {
      '/proj': [
        { name: 'main.py', path: '/proj/main.py', kind: 'file' },
        { name: 'readme.md', path: '/proj/readme.md', kind: 'file' },
        { name: 'src', path: '/proj/src', kind: 'directory' },
        { name: 'node_modules', path: '/proj/node_modules', kind: 'directory' },
        { name: 'experiments', path: '/proj/experiments', kind: 'directory' },
      ],
      '/proj/src': [
        { name: 'vqe.py', path: '/proj/src/vqe.py', kind: 'file' },
        { name: 'Main.qs', path: '/proj/src/Main.qs', kind: 'file' },
      ],
      '/proj/node_modules': [
        { name: 'ignored.py', path: '/proj/node_modules/ignored.py', kind: 'file' },
      ],
      '/proj/experiments': [
        { name: 'theta-sweep.experiment.yaml', path: '/proj/experiments/theta-sweep.experiment.yaml', kind: 'file' },
      ],
    };
    const port = { listDirectory: async (path: string) => tree[path] ?? null };

    const files = await discoverEntryFiles(port, '/proj');
    expect(files).toEqual(['main.py', 'src/Main.qs', 'src/vqe.py']);
  });

  it('never throws when listing fails', async () => {
    const port = { listDirectory: async () => { throw new Error('boom'); } };
    await expect(discoverEntryFiles(port, '/proj')).resolves.toEqual([]);
  });
});
