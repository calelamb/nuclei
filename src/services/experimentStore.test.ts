import { beforeEach, describe, expect, it } from 'vitest';
import { useExperimentStore, type ExperimentFs } from './experimentStore';
import type { RunManifest } from '../types/experiment';

// ---------------------------------------------------------------------------
// In-memory mock filesystem
// ---------------------------------------------------------------------------

interface MockFile {
  content: string;
}

/** Builds an ExperimentFs over a flat path->content map + a set of dirs. */
function makeMockFs(files: Record<string, string>, dirs: string[]): ExperimentFs {
  const fileMap = new Map<string, MockFile>(
    Object.entries(files).map(([p, content]) => [p, { content }]),
  );
  const dirSet = new Set(dirs);

  const join = (...parts: string[]) => parts.filter(Boolean).join('/');

  return {
    join,
    async exists(path) {
      return fileMap.has(path) || dirSet.has(path);
    },
    async readTextFile(path) {
      const f = fileMap.get(path);
      if (!f) throw new Error(`ENOENT: ${path}`);
      return f.content;
    },
    async readDir(path) {
      const prefix = `${path}/`;
      const names = new Set<string>();
      const isDir = new Map<string, boolean>();
      for (const key of [...fileMap.keys(), ...dirSet]) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        names.add(name);
        const full = `${path}/${name}`;
        // Directory if it's in dirSet OR something lives beneath it.
        if (dirSet.has(full) || rest.includes('/')) isDir.set(name, true);
        else if (!isDir.has(name)) isDir.set(name, false);
      }
      return [...names].map((name) => ({ name, isDirectory: isDir.get(name) ?? false }));
    },
  };
}

const VALID_YAML = `schema: 1
name: theta-sweep
entry: run.py
backend:
  provider: simulator
  target: statevector
shots: 100
seed: 42
sweep:
  theta:
    values: [0, 1]
`;

const MALFORMED_YAML = `schema: 1
entry: broken.py
backend:
  provider: simulator
shots: not-a-number
seed: 0
`;

function manifest(pointIndex: number, status: RunManifest['status']): RunManifest {
  return {
    schema: 1,
    experiment: 'theta-sweep',
    point_index: pointIndex,
    params: { theta: pointIndex },
    seed: 42 + pointIndex,
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
    status,
    error: null,
  };
}

describe('experimentStore', () => {
  beforeEach(() => {
    useExperimentStore.getState().clear();
  });

  it('discovers valid experiments and surfaces malformed ones as validation errors', async () => {
    const fs = makeMockFs(
      {
        '/proj/experiments/theta-sweep.experiment.yaml': VALID_YAML,
        '/proj/experiments/broken.experiment.yaml': MALFORMED_YAML,
      },
      ['/proj/experiments'],
    );
    await useExperimentStore.getState().reload('/proj', fs);

    const state = useExperimentStore.getState();
    expect(state.loading).toBe(false);
    expect(state.experiments).toHaveLength(1);
    expect(state.experiments[0].fileName).toBe('theta-sweep.experiment.yaml');
    expect(state.experiments[0].spec.name).toBe('theta-sweep');

    expect(state.validationErrors).toHaveLength(1);
    expect(state.validationErrors[0].fileName).toBe('broken.experiment.yaml');
    expect(state.validationErrors[0].errors.length).toBeGreaterThan(0);
  });

  it('ignores non-experiment files and returns empty when no experiments/ dir', async () => {
    const fs = makeMockFs({}, []);
    await useExperimentStore.getState().reload('/proj', fs);
    expect(useExperimentStore.getState().experiments).toEqual([]);
    expect(useExperimentStore.getState().validationErrors).toEqual([]);
  });

  it('lazily scans an experiment run directory into records', async () => {
    const fs = makeMockFs(
      {
        '/proj/experiments/theta-sweep.experiment.yaml': VALID_YAML,
        '/proj/experiments/theta-sweep/runs/20260712-141530-aaaa/manifest.json': JSON.stringify(
          manifest(0, 'complete'),
        ),
        '/proj/experiments/theta-sweep/runs/20260712-141530-aaaa/metrics.json': JSON.stringify({
          counts_entropy: 1,
          energy: -1.1,
        }),
        '/proj/experiments/theta-sweep/runs/20260712-141540-bbbb/manifest.json': JSON.stringify(
          manifest(1, 'complete'),
        ),
      },
      [
        '/proj/experiments',
        '/proj/experiments/theta-sweep/runs',
        '/proj/experiments/theta-sweep/runs/20260712-141530-aaaa',
        '/proj/experiments/theta-sweep/runs/20260712-141540-bbbb',
      ],
    );
    await useExperimentStore.getState().reload('/proj', fs);
    const experiment = useExperimentStore.getState().experiments[0];
    await useExperimentStore.getState().scanRuns(experiment, '/proj', fs);

    const runs = useExperimentStore.getState().runsByExperiment['theta-sweep.experiment.yaml'];
    expect(runs).toHaveLength(2);
    // Newest first by dir name.
    expect(runs[0].dir).toBe('20260712-141540-bbbb');
    expect(runs[1].metrics).toEqual({ counts_entropy: 1, energy: -1.1 });
  });

  it('normalizes a non-terminal (running) manifest to stale on scan', async () => {
    const fs = makeMockFs(
      {
        '/proj/experiments/theta-sweep.experiment.yaml': VALID_YAML,
        '/proj/experiments/theta-sweep/runs/20260712-141530-cccc/manifest.json': JSON.stringify(
          manifest(0, 'running'),
        ),
      },
      [
        '/proj/experiments',
        '/proj/experiments/theta-sweep/runs',
        '/proj/experiments/theta-sweep/runs/20260712-141530-cccc',
      ],
    );
    await useExperimentStore.getState().reload('/proj', fs);
    const experiment = useExperimentStore.getState().experiments[0];
    await useExperimentStore.getState().scanRuns(experiment, '/proj', fs);
    const runs = useExperimentStore.getState().runsByExperiment['theta-sweep.experiment.yaml'];
    expect(runs[0].manifest.status).toBe('stale');
  });

  it('skips run directories without a valid manifest', async () => {
    const fs = makeMockFs(
      {
        '/proj/experiments/theta-sweep.experiment.yaml': VALID_YAML,
        '/proj/experiments/theta-sweep/runs/junk/notes.txt': 'not a run',
        '/proj/experiments/theta-sweep/runs/bad/manifest.json': '{ not valid json',
      },
      [
        '/proj/experiments',
        '/proj/experiments/theta-sweep/runs',
        '/proj/experiments/theta-sweep/runs/junk',
        '/proj/experiments/theta-sweep/runs/bad',
      ],
    );
    await useExperimentStore.getState().reload('/proj', fs);
    const experiment = useExperimentStore.getState().experiments[0];
    await useExperimentStore.getState().scanRuns(experiment, '/proj', fs);
    expect(useExperimentStore.getState().runsByExperiment['theta-sweep.experiment.yaml']).toEqual([]);
  });

  it('drops cached runs for experiments that disappear on reload', async () => {
    const withExp = makeMockFs(
      { '/proj/experiments/theta-sweep.experiment.yaml': VALID_YAML },
      ['/proj/experiments'],
    );
    await useExperimentStore.getState().reload('/proj', withExp);
    const experiment = useExperimentStore.getState().experiments[0];
    await useExperimentStore.getState().scanRuns(experiment, '/proj', withExp);
    // Seed a fake cached-run entry manually to prove it's cleared.
    expect(
      useExperimentStore.getState().runsByExperiment['theta-sweep.experiment.yaml'],
    ).toBeDefined();

    const empty = makeMockFs({}, ['/proj/experiments']);
    await useExperimentStore.getState().reload('/proj', empty);
    expect(useExperimentStore.getState().experiments).toEqual([]);
    expect(useExperimentStore.getState().runsByExperiment).toEqual({});
  });
});
