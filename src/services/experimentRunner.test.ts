import { describe, expect, it } from 'vitest';
import {
  runExperiment,
  runsDirForExperiment,
  type RunnerDeps,
  type RunnerKernelSession,
  type RunExperimentContext,
} from './experimentRunner';
import { runManifestSchema, type ExperimentSpec } from '../types/experiment';
import type { KernelMessage, KernelResponse, SimulationResult } from '../types/quantum';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type Responder = (message: KernelMessage, executeIndex: number) => KernelResponse[];

function makeSession(respond: Responder): RunnerKernelSession & { sent: KernelMessage[] } {
  const handlers = new Set<(m: KernelResponse) => void>();
  let executeIndex = -1;
  const sent: KernelMessage[] = [];
  return {
    sent,
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    send(message) {
      sent.push(message);
      if (message.type === 'execute' || message.type === 'hardware_submit') executeIndex += 1;
      const responses = respond(message, executeIndex);
      for (const r of responses) {
        for (const h of [...handlers]) h(r);
      }
    },
  };
}

function makeFs() {
  const files = new Map<string, string>();
  const dirs: string[] = [];
  return {
    files,
    dirs,
    writer: {
      async mkdir(path: string) {
        dirs.push(path);
      },
      async writeFile(path: string, content: string) {
        files.set(path, content);
      },
    },
  };
}

const FIXED_DATE = new Date('2026-07-12T14:15:30.000Z');

function makeDeps(session: RunnerKernelSession, overrides: Partial<RunnerDeps> = {}): {
  deps: RunnerDeps;
  fs: ReturnType<typeof makeFs>;
} {
  const fs = makeFs();
  const deps: RunnerDeps = {
    session,
    fs: fs.writer,
    clock: { now: () => FIXED_DATE },
    join: (...parts) => parts.join('/'),
    hash: async () => 'beefcafe00000000',
    gitInfo: async () => ({ commit: 'commit123', dirty: true }),
    environment: async () => ({
      python: '3.12.4',
      platform: 'darwin',
      packages: { qiskit: '1.4.1' },
    }),
    readEntry: async () => 'print("hi")',
    appVersion: '0.6.0',
    wait: async () => {},
    hardwarePollMs: 1,
    ...overrides,
  };
  return { deps, fs };
}

function simResult(measurements: Record<string, number>): SimulationResult {
  return {
    state_vector: [],
    probabilities: {},
    measurements,
    bloch_coords: [],
    execution_time_ms: 1,
    shot_count: Object.values(measurements).reduce((a, b) => a + b, 0),
    metrics: {},
    seed_honored: true,
  };
}

const BASE_SPEC: ExperimentSpec = {
  schema: 1,
  name: 'theta-sweep',
  entry: 'run.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 100,
  seed: 42,
  sweep: { theta: { values: [0, 1, 2] } },
};

const CTX: RunExperimentContext = {
  projectRoot: '/proj',
  experimentFileName: 'theta-sweep.experiment.yaml',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runsDirForExperiment', () => {
  it('derives the runs directory from the yaml filename', () => {
    const dir = runsDirForExperiment((...p) => p.join('/'), '/proj', 'theta-sweep.experiment.yaml');
    expect(dir).toBe('/proj/experiments/theta-sweep/runs');
  });
});

describe('runExperiment — simulator', () => {
  it('runs points in order with seed = base + i and injected params', async () => {
    const session = makeSession((msg) => {
      if (msg.type === 'execute') {
        return [{ type: 'result', data: simResult({ '00': 100 }) }];
      }
      return [];
    });
    const { deps } = makeDeps(session);
    const summary = await runExperiment(BASE_SPEC, CTX, deps);

    expect(summary.total).toBe(3);
    expect(summary.completed).toBe(3);
    expect(summary.failed).toBe(0);

    const executes = session.sent.filter((m) => m.type === 'execute') as Array<
      Extract<KernelMessage, { type: 'execute' }>
    >;
    expect(executes.map((e) => e.params)).toEqual([{ theta: 0 }, { theta: 1 }, { theta: 2 }]);
    expect(executes.map((e) => e.seed)).toEqual([42, 43, 44]);
  });

  it('writes a full run directory with PRD-shaped manifest and derived metrics', async () => {
    const session = makeSession((msg) =>
      msg.type === 'execute'
        ? [
            { type: 'output', text: 'hello\n' },
            { type: 'stderr', text: 'warn\n' },
            { type: 'result', data: { ...simResult({ '00': 500, '11': 500 }), metrics: { energy: -1.13 } } },
          ]
        : [],
    );
    const { deps, fs } = makeDeps(session);
    const spec: ExperimentSpec = { ...BASE_SPEC, sweep: undefined };
    const summary = await runExperiment(spec, CTX, deps);

    expect(summary.runDirs).toEqual(['20260712-141530-beef']);
    const dir = '/proj/experiments/theta-sweep/runs/20260712-141530-beef';

    const manifest = JSON.parse(fs.files.get(`${dir}/manifest.json`)!);
    const parsed = runManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(manifest.experiment).toBe('theta-sweep');
    expect(manifest.point_index).toBe(0);
    expect(manifest.seed).toBe(42);
    expect(manifest.seed_honored).toBe(true);
    expect(manifest.git).toEqual({ commit: 'commit123', dirty: true });
    expect(manifest.versions).toEqual({ nuclei: '0.6.0', python: '3.12.4', qiskit: '1.4.1' });
    expect(manifest.code_sha256).toBe('beefcafe00000000');
    expect(manifest.status).toBe('complete');
    expect(manifest.started_at).toBe('2026-07-12T14:15:30.000Z');

    // Derived metrics + user metric merged.
    const metrics = JSON.parse(fs.files.get(`${dir}/metrics.json`)!);
    expect(metrics.counts_entropy).toBeCloseTo(1, 10);
    expect(metrics.top_state_probability).toBeCloseTo(0.5, 10);
    expect(metrics.energy).toBe(-1.13);

    expect(fs.files.get(`${dir}/stdout.txt`)).toBe('hello\n');
    expect(fs.files.get(`${dir}/stderr.txt`)).toBe('warn\n');
    expect(JSON.parse(fs.files.get(`${dir}/result.json`)!).measurements).toEqual({ '00': 500, '11': 500 });
  });

  it('continues after a failed point and reports it in the summary', async () => {
    const session = makeSession((msg, idx) => {
      if (msg.type !== 'execute') return [];
      if (idx === 1) {
        return [{ type: 'error', message: 'boom at theta=1', phase: 'execute' }];
      }
      return [{ type: 'result', data: simResult({ '00': 100 }) }];
    });
    const { deps } = makeDeps(session);
    const summary = await runExperiment(BASE_SPEC, CTX, deps);

    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].pointIndex).toBe(1);
    expect(summary.failures[0].params).toEqual({ theta: 1 });
    expect(summary.failures[0].error).toMatch(/boom at theta=1/);
    // All three run dirs still written (the failed one included).
    expect(summary.runDirs).toHaveLength(3);
  });

  it('marks seed_honored false when the kernel reports it', async () => {
    const session = makeSession((msg) =>
      msg.type === 'execute'
        ? [{ type: 'result', data: { ...simResult({ '00': 100 }), seed_honored: false } }]
        : [],
    );
    const { deps, fs } = makeDeps(session);
    await runExperiment({ ...BASE_SPEC, sweep: undefined }, CTX, deps);
    const manifest = JSON.parse(
      fs.files.get('/proj/experiments/theta-sweep/runs/20260712-141530-beef/manifest.json')!,
    );
    expect(manifest.seed_honored).toBe(false);
  });

  it('stops after the current point when the signal is aborted', async () => {
    const signal = { aborted: false };
    let completedCount = 0;
    const session = makeSession((msg) =>
      msg.type === 'execute' ? [{ type: 'result', data: simResult({ '00': 100 }) }] : [],
    );
    const { deps } = makeDeps(session);
    const summary = await runExperiment(BASE_SPEC, CTX, deps, {
      onProgress: () => {
        completedCount += 1;
        // Abort after the first point completes.
        if (completedCount === 1) signal.aborted = true;
      },
      signal,
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.completed).toBe(1);
    expect(summary.runDirs).toHaveLength(1);
    // Only one execute was ever sent — the sweep stopped before point 2.
    expect(session.sent.filter((m) => m.type === 'execute')).toHaveLength(1);
  });

  it('emits progress events with completed/total/failures', async () => {
    const session = makeSession((msg) =>
      msg.type === 'execute' ? [{ type: 'result', data: simResult({ '00': 100 }) }] : [],
    );
    const { deps } = makeDeps(session);
    const events: Array<{ completed: number; total: number }> = [];
    await runExperiment(BASE_SPEC, CTX, deps, {
      onProgress: (p) => events.push({ completed: p.completed, total: p.total }),
    });
    expect(events).toEqual([
      { completed: 1, total: 3 },
      { completed: 2, total: 3 },
      { completed: 3, total: 3 },
    ]);
  });
});

describe('runExperiment — hardware', () => {
  const HW_SPEC: ExperimentSpec = {
    ...BASE_SPEC,
    backend: { provider: 'ionq', target: 'ionq.qpu' },
    sweep: { theta: { values: [0] } },
  };

  it('drives submit -> status -> results and writes the run dir', async () => {
    const session = makeSession((msg) => {
      if (msg.type === 'hardware_submit') {
        return [
          {
            type: 'hardware_job_submitted',
            job: {
              id: 'job-1',
              provider: 'ionq',
              backend: 'ionq.qpu',
              status: 'queued',
              queue_position: 1,
              shots: 100,
              submitted_at: '2026-07-12T14:15:30Z',
            },
          },
        ];
      }
      if (msg.type === 'hardware_status') {
        return [
          {
            type: 'hardware_job_update',
            job: {
              id: 'job-1',
              provider: 'ionq',
              backend: 'ionq.qpu',
              status: 'complete',
              queue_position: null,
              shots: 100,
              submitted_at: '2026-07-12T14:15:30Z',
            },
          },
        ];
      }
      if (msg.type === 'hardware_results') {
        return [
          {
            type: 'hardware_result',
            job_id: 'job-1',
            data: { measurements: { '000': 60, '111': 40 } },
          },
        ];
      }
      return [];
    });
    const { deps, fs } = makeDeps(session);
    const summary = await runExperiment(HW_SPEC, CTX, deps);

    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    const dir = '/proj/experiments/theta-sweep/runs/20260712-141530-beef';
    const manifest = JSON.parse(fs.files.get(`${dir}/manifest.json`)!);
    expect(manifest.backend).toEqual({ provider: 'ionq', target: 'ionq.qpu' });
    expect(manifest.seed_honored).toBe(false); // hardware isn't seedable in v1
    expect(manifest.status).toBe('complete');
    const metrics = JSON.parse(fs.files.get(`${dir}/metrics.json`)!);
    expect(metrics.top_state_probability).toBeCloseTo(0.6, 10);
  });

  it('records a failed manifest when the hardware job fails', async () => {
    const session = makeSession((msg) => {
      if (msg.type === 'hardware_submit') {
        return [
          {
            type: 'hardware_job_submitted',
            job: {
              id: 'job-x',
              provider: 'ionq',
              backend: 'ionq.qpu',
              status: 'queued',
              queue_position: 1,
              shots: 100,
              submitted_at: '2026-07-12T14:15:30Z',
            },
          },
        ];
      }
      if (msg.type === 'hardware_status') {
        return [
          {
            type: 'hardware_job_update',
            job: {
              id: 'job-x',
              provider: 'ionq',
              backend: 'ionq.qpu',
              status: 'failed',
              queue_position: null,
              shots: 100,
              submitted_at: '2026-07-12T14:15:30Z',
              error: 'device offline',
            },
          },
        ];
      }
      return [];
    });
    const { deps, fs } = makeDeps(session);
    const summary = await runExperiment(HW_SPEC, CTX, deps);
    expect(summary.failed).toBe(1);
    const manifest = JSON.parse(
      fs.files.get('/proj/experiments/theta-sweep/runs/20260712-141530-beef/manifest.json')!,
    );
    expect(manifest.status).toBe('failed');
    expect(manifest.error).toMatch(/device offline/);
  });
});
