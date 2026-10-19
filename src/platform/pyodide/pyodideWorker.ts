/**
 * Pyodide web worker: boots Pyodide, installs the browser Qiskit subset and
 * kernel runtime, and serves parse/execute/run_python calls off the main
 * thread so the UI never freezes while Python loads or user code runs.
 *
 * Cirq is not part of boot: it is a large micropip install, so it is fetched
 * the first time a program mentions it (and reported via a `notice`).
 */
import kernelRuntimeSource from './kernel_runtime.py?raw';
import {
  BOOT_STAGES,
  type RuntimeFunction,
  type WorkerRequest,
  type WorkerResponse,
} from './workerProtocol';

const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/';
const SHIM_ROOT = '/opt/nuclei';
// cirq-core 1.5.0 is the first release compatible with numpy 2.x (Pyodide 0.27).
const CIRQ_REQUIREMENT = 'cirq-core==1.5.0';

const shimSources = import.meta.glob('./shim/**/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface PyodideApi {
  loadPackage(name: string): Promise<void>;
  pyimport(name: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any -- PyProxy has no published types
  runPython(code: string): unknown;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string): void;
  };
}

type PyodideLoader = (options: { indexURL: string }) => Promise<PyodideApi>;

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

let pyodide: PyodideApi | null = null;
let runtime: Record<RuntimeFunction, (...args: unknown[]) => string> | null = null;
let cirqPromise: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();

function post(message: WorkerResponse) {
  scope.postMessage(message);
}

function reportStage(index: number) {
  const stage = BOOT_STAGES[index];
  post({
    type: 'progress',
    progress: { step: index + 1, total: BOOT_STAGES.length, label: stage.label, fraction: stage.fraction },
  });
}

function writeShimFiles(py: PyodideApi) {
  py.FS.mkdirTree(SHIM_ROOT);
  py.FS.writeFile(`${SHIM_ROOT}/kernel_runtime.py`, kernelRuntimeSource);
  for (const [path, source] of Object.entries(shimSources)) {
    const relative = path.replace(/^\.\/shim\//, '');
    const target = `${SHIM_ROOT}/shim/${relative}`;
    py.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
    py.FS.writeFile(target, source);
  }
  py.runPython(
    `import sys\nfor p in ("${SHIM_ROOT}/shim", "${SHIM_ROOT}"):\n    if p not in sys.path:\n        sys.path.insert(0, p)`,
  );
}

async function boot(): Promise<void> {
  reportStage(0);
  const mod = (await import(/* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`)) as { loadPyodide: PyodideLoader };
  const py = await mod.loadPyodide({ indexURL: PYODIDE_BASE });

  reportStage(1);
  await py.loadPackage('numpy');

  reportStage(2);
  writeShimFiles(py);
  // Warm the import caches so the first parse does not pay for them.
  py.runPython('import qiskit, qiskit_aer, qiskit.quantum_info, qiskit.circuit.library');
  const kernel = py.pyimport('kernel_runtime');
  // Live output: each complete line the program prints is posted as it is
  // written (a synchronous post, so it reaches the page while Python is still
  // running), tagged with the call that printed it so it never reaches other
  // listeners. The page coalesces these into batches.
  kernel.set_output_sink((line: string) => {
    if (activeCallId !== null) post({ id: activeCallId, type: 'stdout', text: line });
  });
  runtime = {
    nuclei_parse: (...a) => kernel.nuclei_parse(...a) as string,
    nuclei_execute: (...a) => kernel.nuclei_execute(...a) as string,
    nuclei_run_python: (...a) => kernel.nuclei_run_python(...a) as string,
  };
  pyodide = py;
}

function ensureCirq(): Promise<void> {
  if (cirqPromise) return cirqPromise;
  const py = pyodide;
  if (!py) return Promise.reject(new Error('Python is not ready'));
  post({ type: 'notice', text: 'Installing Cirq (first use, about 10 seconds)…' });
  post({ type: 'installing', package: 'Cirq', active: true });
  cirqPromise = (async () => {
    try {
      await py.loadPackage('micropip');
      await py.pyimport('micropip').install(CIRQ_REQUIREMENT);
      // Importing cirq takes seconds the first time; do it now so the student's
      // own `import cirq` (inside the parse/run time budget) is instant.
      py.runPython('import cirq');
    } finally {
      post({ type: 'installing', package: 'Cirq', active: false });
    }
  })();
  cirqPromise.catch(() => { cirqPromise = null; }); // allow a retry after a network failure
  return cirqPromise;
}

const CIRQ_MENTION = /\b(?:import|from)\s+cirq\b/;

/** The call whose Python is running right now; live output is tagged with it. */
let activeCallId: number | null = null;

async function runCall(id: number, fn: RuntimeFunction, args: unknown[]): Promise<string> {
  if (!runtime) throw new Error('Python is not ready');
  if (typeof args[0] === 'string' && CIRQ_MENTION.test(args[0])) {
    try {
      await ensureCirq();
    } catch (error) {
      throw new Error(
        `Couldn't install Cirq in the browser (${error instanceof Error ? error.message : String(error)}). Check your connection and try again.`,
      );
    }
  }
  // From here the user's Python is running: the client's timeout starts now,
  // so waiting behind another call or installing Cirq never counts against it.
  post({ id, type: 'started' });
  activeCallId = id;
  try {
    return runtime[fn](...args);
  } finally {
    activeCallId = null;
  }
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    if (request.type === 'init') {
      if (!runtime) await boot();
      post({ id: request.id, type: 'result', value: 'ready' });
      return;
    }
    const value = await runCall(request.id, request.fn, request.args);
    post({ id: request.id, type: 'result', value });
  } catch (error) {
    post({
      id: request.id,
      type: 'failure',
      code: request.type === 'init' ? 'load_failed' : 'runtime_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

scope.onmessage = (event) => {
  // Serialise requests: Python state (sys.stdout swaps) is not re-entrant.
  queue = queue.then(() => handle(event.data));
};
