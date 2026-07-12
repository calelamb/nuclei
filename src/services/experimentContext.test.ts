import { describe, expect, it } from 'vitest';
import { buildExperimentContext, EXPERIMENT_CONTEXT_FULL_RUN_CAP } from './experimentContext';
import type { ExperimentSpec, RunManifest, RunRecord } from '../types/experiment';

const SPEC: ExperimentSpec = {
  schema: 1,
  name: 'theta-sweep',
  entry: 'vqe.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 1024,
  seed: 42,
  sweep: { theta: { values: [0, 1, 2] } },
};

function manifest(pointIndex: number): RunManifest {
  return {
    schema: 1,
    experiment: 'theta-sweep',
    point_index: pointIndex,
    params: { theta: pointIndex },
    seed: 42 + pointIndex,
    seed_honored: true,
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 1024,
    language: 'python',
    entry: 'vqe.py',
    code_sha256: 'abc',
    git: null,
    versions: { nuclei: '0.6.0' },
    started_at: '2026-07-12T14:15:30Z',
    duration_ms: 10,
    status: 'complete',
    error: null,
  };
}

function run(dir: string, pointIndex: number): RunRecord {
  return { dir, manifest: manifest(pointIndex), metrics: { energy: -pointIndex } };
}

describe('buildExperimentContext', () => {
  it('always includes the active experiment as YAML', () => {
    const context = buildExperimentContext({ fileName: 'theta-sweep.experiment.yaml', spec: SPEC }, []);
    expect(context).toContain('## Active Experiment (theta-sweep.experiment.yaml)');
    expect(context).toContain('```yaml');
    expect(context).toContain('name: theta-sweep');
    expect(context).toContain('shots: 1024');
  });

  it('omits the Selected Runs section when nothing is selected', () => {
    const context = buildExperimentContext({ fileName: 'x.experiment.yaml', spec: SPEC }, []);
    expect(context).not.toContain('Selected Runs');
  });

  it('includes full manifests when at or under the cap', () => {
    const runs = Array.from({ length: EXPERIMENT_CONTEXT_FULL_RUN_CAP }, (_, i) => run(`run-${i}`, i));
    const context = buildExperimentContext({ fileName: 'x.experiment.yaml', spec: SPEC }, runs);
    expect(context).toContain(`## Selected Runs (${EXPERIMENT_CONTEXT_FULL_RUN_CAP}, full manifests)`);
    expect(context).toContain('"point_index":0');
    expect(context).toContain('"seed_honored":true');
    expect(context).toContain('run-0');
    expect(context).toContain(`run-${EXPERIMENT_CONTEXT_FULL_RUN_CAP - 1}`);
  });

  it('falls back to metrics-only beyond the cap, and never includes manifest fields', () => {
    const runs = Array.from({ length: EXPERIMENT_CONTEXT_FULL_RUN_CAP + 5 }, (_, i) => run(`run-${i}`, i));
    const context = buildExperimentContext({ fileName: 'x.experiment.yaml', spec: SPEC }, runs);
    expect(context).toContain(`## Selected Runs (${EXPERIMENT_CONTEXT_FULL_RUN_CAP + 5}, metrics only`);
    expect(context).not.toContain('point_index');
    expect(context).not.toContain('seed_honored');
    expect(context).toContain('"energy":0');
  });

  it('is a boundary at exactly the cap (cap itself is still full manifests)', () => {
    const atCap = Array.from({ length: EXPERIMENT_CONTEXT_FULL_RUN_CAP }, (_, i) => run(`r${i}`, i));
    const overCap = Array.from({ length: EXPERIMENT_CONTEXT_FULL_RUN_CAP + 1 }, (_, i) => run(`r${i}`, i));
    expect(buildExperimentContext({ fileName: 'x.yaml', spec: SPEC }, atCap)).toContain('full manifests');
    expect(buildExperimentContext({ fileName: 'x.yaml', spec: SPEC }, overCap)).toContain('metrics only');
  });
});
