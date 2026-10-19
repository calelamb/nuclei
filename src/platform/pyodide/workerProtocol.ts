/**
 * Message protocol between the main thread (pyodideClient) and the Pyodide
 * web worker (pyodideWorker). Everything crossing the boundary is plain,
 * structured-cloneable data: Python results travel as JSON strings.
 */

/** Browser kernel entry points exported by kernel_runtime.py. */
export type RuntimeFunction = 'nuclei_parse' | 'nuclei_execute' | 'nuclei_run_python';

export interface BootProgress {
  /** 1-based step currently running. */
  step: number;
  total: number;
  /** Human text for the stage, e.g. "Downloading Python". */
  label: string;
  /** 0..1 overall completion at the start of this stage. */
  fraction: number;
}

export interface RuntimeInfo {
  /** Whether Cirq has been installed into this worker yet (lazy, first use). */
  cirqInstalled: boolean;
}

export type WorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'call'; fn: RuntimeFunction; args: unknown[] };

export type WorkerResponse =
  | { type: 'progress'; progress: BootProgress }
  /** A line for the terminal: a lazy-install notice (not tied to one call). */
  | { type: 'notice'; text: string }
  /** A lazy package install (Cirq) began or finished: a kernel phase the whole UI reports. */
  | { type: 'installing'; package: string; active: boolean }
  /** One line of a call's live program output; only that call's caller sees it. */
  | { id: number; type: 'stdout'; text: string }
  /** The worker has begun running this call's Python (after any lazy installs). */
  | { id: number; type: 'started' }
  | { id: number; type: 'result'; value: string }
  | { id: number; type: 'failure'; message: string; code: 'load_failed' | 'runtime_error' };

/** Boot stages, in order. Cirq is installed lazily on first use, not here. */
export const BOOT_STAGES: ReadonlyArray<{ label: string; fraction: number }> = [
  { label: 'Downloading Python', fraction: 0 },
  { label: 'Loading NumPy', fraction: 0.6 },
  { label: 'Starting Python', fraction: 0.85 },
];
