import { create } from 'zustand';
import {
  parseExperimentYaml,
  runManifestSchema,
  type ExperimentSpec,
  type RunManifest,
  type RunRecord,
} from '../types/experiment';

/**
 * PRD 09 Phase C — experiment discovery + run-scan store.
 *
 * "Files, not a database": experiments and runs are plain files in the open
 * project. This store discovers `experiments/*.experiment.yaml`, surfaces
 * malformed files as DATA (never a crash), and lazily scans an experiment's
 * `runs/` directory on demand. All file I/O goes through an injected
 * `ExperimentFs`, so the store is fully testable without Tauri.
 */

// ---------------------------------------------------------------------------
// Injected filesystem port
// ---------------------------------------------------------------------------

export interface ExperimentDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface ExperimentFs {
  readTextFile(path: string): Promise<string>;
  readDir(path: string): Promise<ExperimentDirEntry[]>;
  exists(path: string): Promise<boolean>;
  join(...parts: string[]): string;
  /**
   * Optional file watcher, scoped by the caller to `experiments/` only.
   * Returns an unwatch fn. When absent, callers fall back to manual reload.
   */
  watch?(
    path: string,
    onEvent: () => void,
    options?: { recursive?: boolean },
  ): Promise<() => void>;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export interface DiscoveredExperiment {
  /** Yaml filename, e.g. `theta-sweep.experiment.yaml`. */
  fileName: string;
  /** Absolute path to the yaml file. */
  path: string;
  spec: ExperimentSpec;
}

export interface ExperimentValidationError {
  fileName: string;
  path: string;
  errors: string[];
}

interface ExperimentStoreState {
  loading: boolean;
  experiments: DiscoveredExperiment[];
  validationErrors: ExperimentValidationError[];
  /** Keyed by experiment fileName. */
  runsByExperiment: Record<string, RunRecord[]>;

  reload(projectRoot: string, fs: ExperimentFs): Promise<void>;
  scanRuns(experiment: DiscoveredExperiment, projectRoot: string, fs: ExperimentFs): Promise<void>;
  startWatching(projectRoot: string, fs: ExperimentFs): Promise<void>;
  stopWatching(): void;
  clear(): void;
}

const EXPERIMENT_SUFFIX = /\.experiment\.ya?ml$/i;
const DEBOUNCE_MS = 250;

/** Non-terminal on-disk statuses read as `stale` in memory after a restart. */
function normalizeRunStatus(status: RunManifest['status']): RunManifest['status'] {
  return status === 'running' ? 'stale' : status;
}

function experimentBaseName(fileName: string): string {
  return fileName.replace(EXPERIMENT_SUFFIX, '');
}

// ---------------------------------------------------------------------------
// Discovery + scanning (pure-ish helpers over the injected fs)
// ---------------------------------------------------------------------------

interface DiscoveryResult {
  experiments: DiscoveredExperiment[];
  validationErrors: ExperimentValidationError[];
}

async function discover(projectRoot: string, fs: ExperimentFs): Promise<DiscoveryResult> {
  const experimentsDir = fs.join(projectRoot, 'experiments');
  const result: DiscoveryResult = { experiments: [], validationErrors: [] };

  if (!(await fs.exists(experimentsDir))) return result;

  let entries: ExperimentDirEntry[];
  try {
    entries = await fs.readDir(experimentsDir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (entry.isDirectory || !EXPERIMENT_SUFFIX.test(entry.name)) continue;
    const path = fs.join(experimentsDir, entry.name);
    let text: string;
    try {
      text = await fs.readTextFile(path);
    } catch (e) {
      result.validationErrors.push({
        fileName: entry.name,
        path,
        errors: [`could not read file: ${e instanceof Error ? e.message : String(e)}`],
      });
      continue;
    }
    const parsed = parseExperimentYaml(text, entry.name);
    if (parsed.ok) {
      result.experiments.push({ fileName: entry.name, path, spec: parsed.spec });
    } else {
      result.validationErrors.push({ fileName: entry.name, path, errors: parsed.errors });
    }
  }

  result.experiments.sort((a, b) => a.fileName.localeCompare(b.fileName));
  result.validationErrors.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return result;
}

async function scanRunDir(
  runDir: string,
  dirName: string,
  fs: ExperimentFs,
): Promise<RunRecord | null> {
  const manifestPath = fs.join(runDir, 'manifest.json');
  let manifestText: string;
  try {
    manifestText = await fs.readTextFile(manifestPath);
  } catch {
    return null; // no manifest -> not a run directory we recognize
  }
  let manifest: RunManifest;
  try {
    const parsed = runManifestSchema.safeParse(JSON.parse(manifestText));
    if (!parsed.success) return null;
    manifest = { ...parsed.data, status: normalizeRunStatus(parsed.data.status) };
  } catch {
    return null;
  }

  let metrics: Record<string, number> = {};
  try {
    const metricsText = await fs.readTextFile(fs.join(runDir, 'metrics.json'));
    const parsedMetrics = JSON.parse(metricsText);
    if (parsedMetrics && typeof parsedMetrics === 'object') {
      for (const [k, v] of Object.entries(parsedMetrics as Record<string, unknown>)) {
        if (typeof v === 'number') metrics[k] = v;
      }
    }
  } catch {
    metrics = {};
  }

  return { dir: dirName, manifest, metrics };
}

async function scanRunsFor(
  experiment: DiscoveredExperiment,
  projectRoot: string,
  fs: ExperimentFs,
): Promise<RunRecord[]> {
  const base = experimentBaseName(experiment.fileName);
  const runsDir = fs.join(projectRoot, 'experiments', base, 'runs');
  if (!(await fs.exists(runsDir))) return [];

  let entries: ExperimentDirEntry[];
  try {
    entries = await fs.readDir(runsDir);
  } catch {
    return [];
  }

  const records: RunRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const record = await scanRunDir(fs.join(runsDir, entry.name), entry.name, fs);
    if (record) records.push(record);
  }
  // Newest first by directory name (which is timestamp-prefixed).
  records.sort((a, b) => b.dir.localeCompare(a.dir));
  return records;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let unwatch: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useExperimentStore = create<ExperimentStoreState>((set, get) => ({
  loading: false,
  experiments: [],
  validationErrors: [],
  runsByExperiment: {},

  reload: async (projectRoot, fs) => {
    set({ loading: true });
    const { experiments, validationErrors } = await discover(projectRoot, fs);
    // Drop cached runs for experiments that no longer exist.
    const live = new Set(experiments.map((e) => e.fileName));
    set((s) => {
      const runsByExperiment: Record<string, RunRecord[]> = {};
      for (const [name, runs] of Object.entries(s.runsByExperiment)) {
        if (live.has(name)) runsByExperiment[name] = runs;
      }
      return { loading: false, experiments, validationErrors, runsByExperiment };
    });
  },

  scanRuns: async (experiment, projectRoot, fs) => {
    const runs = await scanRunsFor(experiment, projectRoot, fs);
    set((s) => ({
      runsByExperiment: { ...s.runsByExperiment, [experiment.fileName]: runs },
    }));
  },

  startWatching: async (projectRoot, fs) => {
    get().stopWatching();
    if (!fs.watch) return;
    const experimentsDir = fs.join(projectRoot, 'experiments');
    if (!(await fs.exists(experimentsDir))) return;
    // Scope the watcher to experiments/ only, debounced.
    unwatch = await fs.watch(
      experimentsDir,
      () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void get().reload(projectRoot, fs);
        }, DEBOUNCE_MS);
      },
      { recursive: true },
    );
  },

  stopWatching: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
  },

  clear: () => {
    get().stopWatching();
    set({ loading: false, experiments: [], validationErrors: [], runsByExperiment: {} });
  },
}));
