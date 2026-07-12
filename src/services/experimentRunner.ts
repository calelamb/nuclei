import type {
  CircuitSnapshot,
  KernelEnvironment,
  KernelMessage,
  KernelResponse,
  SimulationResult,
} from '../types/quantum';
import {
  computeDerivedMetrics,
  expandGrid,
  type ExperimentSpec,
  type GitInfo,
  type RunManifest,
} from '../types/experiment';
import {
  collectHardwareRun,
  collectSimulatorRun,
  versionsFrom,
  writeRunDir,
} from './experimentRunIo';

/**
 * PRD 09 Phase C — sequential experiment runner.
 *
 * The orchestrator lives entirely on the frontend (kernel stays dumb): one
 * `execute` (simulator) or `hardware_submit` (hardware) per sweep point, in
 * order, with `seed = base + i`. Everything it touches — the kernel session,
 * the filesystem, the clock, git/environment lookups, hashing — is injected,
 * so the whole thing is unit-testable with mocks and imports no Tauri. The
 * message-correlation and file-writing helpers live in `experimentRunIo.ts`.
 */

// ---------------------------------------------------------------------------
// Injected ports
// ---------------------------------------------------------------------------

export interface RunnerKernelSession {
  send(message: KernelMessage): void | Promise<void>;
  /** Subscribe to every kernel response; returns an unsubscribe fn. */
  subscribe(handler: (message: KernelResponse) => void): () => void;
}

export interface RunnerFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface RunnerClock {
  now(): Date;
}

export interface RunnerDeps {
  session: RunnerKernelSession;
  fs: RunnerFs;
  clock: RunnerClock;
  /** Path join — injected so the runner is OS/Tauri agnostic. */
  join: (...parts: string[]) => string;
  /** SHA-256 hex of a string (entry code, manifest). */
  hash: (text: string) => Promise<string>;
  /** Git commit/dirty for the project, or null when not a repo. */
  gitInfo: (projectRoot: string) => Promise<GitInfo | null>;
  /** Cached kernel environment (versions), or null when unavailable. */
  environment: () => Promise<KernelEnvironment | null>;
  /** Reads the entry file's current contents. */
  readEntry: (absoluteEntryPath: string) => Promise<string>;
  /** Nuclei app version, stamped into `versions.nuclei`. */
  appVersion: string;
  /** Delay used between hardware status polls (injectable for tests). */
  wait?: (ms: number) => Promise<void>;
  /** Hardware poll interval in ms (default 2000). */
  hardwarePollMs?: number;
}

// ---------------------------------------------------------------------------
// Options + events
// ---------------------------------------------------------------------------

export interface RunProgress {
  completed: number;
  total: number;
  failures: number;
  currentPoint: number;
}

export interface RunExperimentOptions {
  /** Cooperative cancel: checked BEFORE each point (stop-after-current). */
  signal?: { readonly aborted: boolean };
  onProgress?: (progress: RunProgress) => void;
}

export interface RunFailure {
  pointIndex: number;
  params: Record<string, number>;
  error: string;
}

export interface RunSummary {
  total: number;
  completed: number;
  failed: number;
  cancelled: boolean;
  failures: RunFailure[];
  runDirs: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the experiment's on-disk results directory from its yaml path.
 * `experiments/theta-sweep.experiment.yaml` -> `experiments/theta-sweep/runs`.
 */
export function runsDirForExperiment(
  join: (...parts: string[]) => string,
  projectRoot: string,
  experimentFileName: string,
): string {
  const base = experimentFileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.experiment\.yaml$/i, '')
    .replace(/\.ya?ml$/i, '');
  return join(projectRoot, 'experiments', base, 'runs');
}

export interface RunExperimentContext {
  projectRoot: string;
  /** Experiment yaml filename (used to locate the runs directory). */
  experimentFileName: string;
}

/** Per-point outcome, assembled before the manifest is written. */
interface PointOutcome {
  status: RunManifest['status'];
  error: string | null;
  seedHonored: boolean;
  result: SimulationResult | null;
  snapshot: CircuitSnapshot | null;
  stdout: string;
  stderr: string;
  measurements: Record<string, number>;
  userMetrics: Record<string, number>;
}

function freshOutcome(): PointOutcome {
  return {
    status: 'complete',
    error: null,
    seedHonored: true,
    result: null,
    snapshot: null,
    stdout: '',
    stderr: '',
    measurements: {},
    userMetrics: {},
  };
}

async function runSimulatorPoint(
  deps: RunnerDeps,
  spec: ExperimentSpec,
  code: string,
  params: Record<string, number>,
  seed: number,
  out: PointOutcome,
): Promise<void> {
  const collected = await collectSimulatorRun(deps.session, {
    type: 'execute',
    code,
    shots: spec.shots,
    language: spec.language,
    params,
    seed,
  });
  out.stdout = collected.stdout;
  out.stderr = collected.stderr;
  out.snapshot = collected.snapshot;
  if (collected.error || collected.result === null) {
    out.status = 'failed';
    out.error = collected.error ?? 'kernel returned no result';
  } else {
    out.result = collected.result;
    out.measurements = collected.result.measurements ?? {};
    out.userMetrics = collected.result.metrics ?? {};
    out.seedHonored = collected.result.seed_honored ?? false;
  }
}

async function runHardwarePoint(
  deps: RunnerDeps,
  spec: ExperimentSpec,
  code: string,
  out: PointOutcome,
): Promise<void> {
  const hw = await collectHardwareRun(deps, {
    type: 'hardware_submit',
    provider: spec.backend.provider,
    backend: spec.backend.target,
    code,
    shots: spec.shots,
    language: spec.language,
  });
  if (hw.error || hw.measurements === null) {
    out.status = 'failed';
    out.error = hw.error ?? 'hardware run produced no measurements';
  } else {
    out.measurements = hw.measurements;
  }
  // Hardware backends are not seedable in v1 — honesty over pretense.
  out.seedHonored = false;
}

/**
 * Run a full sweep sequentially. Failure policy: a failed point writes a
 * `status: "failed"` manifest and the sweep CONTINUES; failures are summarized
 * at the end. Cancel: checked before each point (stop-after-current); runs
 * already written are kept.
 */
export async function runExperiment(
  spec: ExperimentSpec,
  ctx: RunExperimentContext,
  deps: RunnerDeps,
  opts: RunExperimentOptions = {},
): Promise<RunSummary> {
  const points = expandGrid(spec.sweep);
  const total = points.length;
  const runsDir = runsDirForExperiment(deps.join, ctx.projectRoot, ctx.experimentFileName);
  await deps.fs.mkdir(runsDir, { recursive: true });

  const entryPath = deps.join(ctx.projectRoot, spec.entry);
  const [env, git] = await Promise.all([deps.environment(), deps.gitInfo(ctx.projectRoot)]);

  const summary: RunSummary = {
    total,
    completed: 0,
    failed: 0,
    cancelled: false,
    failures: [],
    runDirs: [],
  };
  const isHardware = spec.backend.provider !== 'simulator';

  for (let i = 0; i < total; i += 1) {
    if (opts.signal?.aborted) {
      summary.cancelled = true;
      break;
    }

    const params = points[i];
    const seed = spec.seed + i;
    const startedAt = deps.clock.now();
    const startMs = startedAt.getTime();
    const out = freshOutcome();

    let code = '';
    try {
      code = await deps.readEntry(entryPath);
      if (isHardware) {
        await runHardwarePoint(deps, spec, code, out);
      } else {
        await runSimulatorPoint(deps, spec, code, params, seed, out);
      }
    } catch (e) {
      out.status = 'failed';
      out.error = e instanceof Error ? e.message : String(e);
    }

    const derived = computeDerivedMetrics(out.measurements);
    // Derived first so an explicitly recorded metric of the same name wins.
    const metrics = { ...derived, ...out.userMetrics };
    const codeSha = await deps.hash(code);

    const manifest: RunManifest = {
      schema: 1,
      experiment: spec.name,
      point_index: i,
      params,
      seed,
      seed_honored: out.seedHonored,
      backend: spec.backend,
      shots: spec.shots,
      language: spec.language,
      entry: spec.entry,
      code_sha256: codeSha,
      git,
      versions: versionsFrom(env, deps.appVersion),
      started_at: startedAt.toISOString(),
      duration_ms: Math.max(0, deps.clock.now().getTime() - startMs),
      status: out.status,
      error: out.error,
    };

    const dirName = await writeRunDir({
      deps,
      runsDir,
      manifest,
      result: out.result,
      snapshot: out.snapshot,
      metrics,
      stdout: out.stdout,
      stderr: out.stderr,
    });
    summary.runDirs.push(dirName);

    if (out.status === 'failed') {
      summary.failed += 1;
      summary.failures.push({ pointIndex: i, params, error: out.error ?? 'unknown error' });
    } else {
      summary.completed += 1;
    }

    opts.onProgress?.({
      completed: summary.completed,
      total,
      failures: summary.failed,
      currentPoint: i,
    });
  }

  return summary;
}
