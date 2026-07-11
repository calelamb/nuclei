import type {
  CircuitSnapshot,
  KernelEnvironment,
  KernelMessage,
  SimulationResult,
} from '../types/quantum';
import type { RunManifest } from '../types/experiment';
import type { RunnerDeps, RunnerKernelSession } from './experimentRunner';

/**
 * PRD 09 Phase C — I/O helpers for the sequential runner.
 *
 * Kept out of `experimentRunner.ts` so each file stays small and the runner
 * reads as pure orchestration. These functions do the message correlation
 * (kernel is serial) and the run-directory writing. Types come back from the
 * runner via type-only imports, so there is no runtime import cycle.
 */

// ---------------------------------------------------------------------------
// Collect one simulator execute
// ---------------------------------------------------------------------------

export interface CollectedRun {
  result: SimulationResult | null;
  snapshot: CircuitSnapshot | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

/**
 * Send one `execute` and collect the correlated stream until the run
 * terminates (`result` or `error`). The kernel is serial, so everything
 * arriving between our send and the terminal message belongs to this point.
 */
export function collectSimulatorRun(
  session: RunnerKernelSession,
  message: Extract<KernelMessage, { type: 'execute' }>,
): Promise<CollectedRun> {
  return new Promise<CollectedRun>((resolve, reject) => {
    const acc: CollectedRun = {
      result: null,
      snapshot: null,
      stdout: '',
      stderr: '',
      error: null,
    };
    const unsubscribe = session.subscribe((msg) => {
      switch (msg.type) {
        case 'output':
          acc.stdout += msg.text;
          break;
        case 'stderr':
          acc.stderr += msg.text;
          break;
        case 'snapshot':
          if (msg.data) acc.snapshot = msg.data;
          break;
        case 'result':
          acc.result = msg.data;
          unsubscribe();
          resolve(acc);
          break;
        case 'error':
          acc.error = msg.message;
          acc.stderr += (acc.stderr ? '\n' : '') + msg.message;
          unsubscribe();
          resolve(acc);
          break;
        default:
          break;
      }
    });
    Promise.resolve(session.send(message)).catch((e) => {
      unsubscribe();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

// ---------------------------------------------------------------------------
// Collect one hardware submission through its lifecycle
// ---------------------------------------------------------------------------

export interface CollectedHardware {
  measurements: Record<string, number> | null;
  jobId: string | null;
  error: string | null;
  status: string;
}

const TERMINAL_HW = new Set(['complete', 'failed']);

/**
 * Submit one hardware job and drive it to a terminal state, reusing the
 * existing `hardware_submit`/`hardware_status`/`hardware_results` protocol.
 * Polls on the injected clock via `wait`.
 */
export async function collectHardwareRun(
  deps: RunnerDeps,
  message: Extract<KernelMessage, { type: 'hardware_submit' }>,
): Promise<CollectedHardware> {
  const { session } = deps;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = deps.hardwarePollMs ?? 2000;

  const state: CollectedHardware = {
    measurements: null,
    jobId: null,
    error: null,
    status: 'queued',
  };
  let resolved = false;

  const finish = () => {
    resolved = true;
  };

  const unsubscribe = session.subscribe((msg) => {
    switch (msg.type) {
      case 'hardware_job_submitted':
        state.jobId = msg.job.id;
        state.status = msg.job.status;
        break;
      case 'hardware_job_update':
        if (state.jobId && msg.job.id === state.jobId) {
          state.status = msg.job.status;
          if (msg.job.error) state.error = msg.job.error;
        }
        break;
      case 'hardware_result':
        if (state.jobId && msg.job_id === state.jobId) {
          if (msg.data?.measurements) state.measurements = msg.data.measurements;
          if (msg.data?.error) state.error = msg.data.error;
          state.status = 'complete';
          finish();
        }
        break;
      default:
        break;
    }
  });

  try {
    await session.send(message);
    // Wait for the submission ack (jobId) before polling.
    while (!state.jobId && !TERMINAL_HW.has(state.status)) {
      await wait(pollMs);
    }
    // Poll status until terminal, then fetch results on completion.
    while (!resolved && !TERMINAL_HW.has(state.status)) {
      if (state.jobId) {
        await session.send({ type: 'hardware_status', job_id: state.jobId });
      }
      await wait(pollMs);
    }
    if (state.status === 'complete' && state.measurements === null && state.jobId) {
      await session.send({ type: 'hardware_results', job_id: state.jobId });
      // Give the result message a few ticks to arrive.
      let waited = 0;
      while (!resolved && waited < 50) {
        await wait(pollMs);
        waited += 1;
      }
    }
    if (state.status === 'failed') {
      state.error = state.error ?? 'hardware job failed';
    }
  } finally {
    unsubscribe();
  }
  return state;
}

// ---------------------------------------------------------------------------
// Run-directory writing
// ---------------------------------------------------------------------------

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** `YYYYMMDD-HHMMSS` in UTC. */
export function timestampSlug(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

export function versionsFrom(
  env: KernelEnvironment | null,
  appVersion: string,
): Record<string, string> {
  const versions: Record<string, string> = { nuclei: appVersion };
  if (env) {
    versions.python = env.python;
    for (const [pkg, ver] of Object.entries(env.packages)) {
      if (ver) versions[pkg] = ver;
    }
  }
  return versions;
}

export interface WriteRunInput {
  deps: RunnerDeps;
  runsDir: string;
  manifest: RunManifest;
  result: SimulationResult | null;
  snapshot: CircuitSnapshot | null;
  metrics: Record<string, number>;
  stdout: string;
  stderr: string;
}

/**
 * Build the run directory name (`<slug>-<4 hex of manifest hash>`) and write
 * every artifact. Returns the run directory basename.
 */
export async function writeRunDir(input: WriteRunInput): Promise<string> {
  const { deps, runsDir, manifest } = input;
  const manifestJson = JSON.stringify(manifest, null, 2);
  const hash = await deps.hash(manifestJson);
  const dirName = `${timestampSlug(new Date(manifest.started_at))}-${hash.slice(0, 4)}`;
  const dir = deps.join(runsDir, dirName);

  await deps.fs.mkdir(dir, { recursive: true });
  await deps.fs.writeFile(deps.join(dir, 'manifest.json'), manifestJson);
  await deps.fs.writeFile(deps.join(dir, 'result.json'), JSON.stringify(input.result, null, 2));
  await deps.fs.writeFile(deps.join(dir, 'snapshot.json'), JSON.stringify(input.snapshot, null, 2));
  await deps.fs.writeFile(deps.join(dir, 'metrics.json'), JSON.stringify(input.metrics, null, 2));
  await deps.fs.writeFile(deps.join(dir, 'stdout.txt'), input.stdout);
  await deps.fs.writeFile(deps.join(dir, 'stderr.txt'), input.stderr);
  return dirName;
}
