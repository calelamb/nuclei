/**
 * Main-thread handle on the Pyodide web worker.
 *
 * One worker is shared by every PyodideKernel instance (editor, lesson demos,
 * challenge runner) so Python is downloaded and booted once. The client owns
 * request/response correlation, boot progress fan-out, per-call timeouts, and
 * recovery: a call that overruns its budget terminates the worker (the only
 * way to stop runaway Python) and the next call boots a fresh one.
 */
import type {
  BootProgress,
  RuntimeFunction,
  WorkerRequest,
  WorkerResponse,
} from './workerProtocol';

export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

export type RuntimeErrorCode = 'load_failed' | 'timeout' | 'runtime_error' | 'stopped';

export class PyodideRuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(message: string, code: RuntimeErrorCode) {
    super(message);
    this.name = 'PyodideRuntimeError';
    this.code = code;
  }
}

export const LOAD_FAILED_MESSAGE =
  "Couldn't start the browser Python engine. Check your connection or content blocker, then retry.";

interface Pending {
  resolve: (value: string) => void;
  reject: (error: PyodideRuntimeError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Budget for the Python itself; the timer starts when the worker reports `started`. */
  timeoutMs: number | undefined;
}

export interface CallOptions {
  /** Terminate and restart the worker if the call takes longer than this. */
  timeoutMs?: number;
}

type ProgressListener = (progress: BootProgress | null) => void;
/** idle = no worker running (never started, or killed after a timeout). */
export type RuntimeState = 'idle' | 'booting' | 'ready';
type StateListener = (state: RuntimeState) => void;
type NoticeListener = (text: string) => void;

export class PyodideRuntimeClient {
  private readonly factory: WorkerFactory;
  private worker: WorkerLike | null = null;
  private ready = false;
  private state: RuntimeState = 'idle';
  private readonly stateListeners = new Set<StateListener>();
  private bootPromise: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly progressListeners = new Set<ProgressListener>();
  private readonly noticeListeners = new Set<NoticeListener>();
  private lastProgress: BootProgress | null = null;
  /** True after a worker was killed: the next boot is a restart, not a first download. */
  private restarted = false;

  constructor(factory: WorkerFactory) {
    this.factory = factory;
  }

  isReady(): boolean {
    return this.ready;
  }

  getState(): RuntimeState {
    return this.state;
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  private setState(state: RuntimeState) {
    if (this.state === state) return;
    this.state = state;
    this.stateListeners.forEach((listener) => listener(state));
  }

  currentProgress(): BootProgress | null {
    return this.lastProgress;
  }

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => { this.progressListeners.delete(listener); };
  }

  onNotice(listener: NoticeListener): () => void {
    this.noticeListeners.add(listener);
    return () => { this.noticeListeners.delete(listener); };
  }

  /** Boot the worker (once). Concurrent callers share the same promise. */
  ensureStarted(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.bootPromise) return this.bootPromise;
    this.setState('booting');
    const promise = this.request({ type: 'init' }).then(
      () => {
        this.ready = true;
        this.setProgress(null);
        this.setState('ready');
      },
      (error: unknown) => {
        this.teardown();
        throw error;
      },
    );
    this.bootPromise = promise;
    promise.catch(() => { if (this.bootPromise === promise) this.bootPromise = null; });
    return promise;
  }

  async call(fn: RuntimeFunction, args: unknown[], options: CallOptions = {}): Promise<string> {
    await this.ensureStarted();
    return this.request({ type: 'call', fn, args }, options.timeoutMs);
  }

  /** Kill the worker; the next call boots a new one. In-flight calls fail as timeouts. */
  restart(): void {
    this.teardown('timeout');
  }

  /** The user asked to stop the running program: kill the worker, fail the call as stopped. */
  stop(): void {
    this.teardown('stopped');
  }

  private request(
    body: { type: 'init' } | { type: 'call'; fn: RuntimeFunction; args: unknown[] },
    timeoutMs?: number,
  ): Promise<string> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, timer: null, timeoutMs });
      worker.postMessage({ ...body, id } as WorkerRequest);
    });
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.factory();
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = (event) => this.failAll(
      new PyodideRuntimeError(event.message ?? LOAD_FAILED_MESSAGE, 'load_failed'),
    );
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: WorkerResponse) {
    if (message.type === 'progress') {
      this.setProgress(message.progress);
      return;
    }
    if (message.type === 'notice') {
      this.noticeListeners.forEach((listener) => listener(message.text));
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    if (message.type === 'started') {
      this.armTimeout(message.id, entry);
      return;
    }
    this.pending.delete(message.id);
    if (entry.timer) clearTimeout(entry.timer);
    if (message.type === 'result') entry.resolve(message.value);
    else entry.reject(new PyodideRuntimeError(
      message.code === 'load_failed' ? LOAD_FAILED_MESSAGE : message.message,
      message.code,
    ));
  }

  private armTimeout(id: number, entry: Pending) {
    if (entry.timeoutMs === undefined || entry.timer) return;
    entry.timer = setTimeout(() => {
      if (!this.pending.has(id)) return;
      this.teardown(); // rejects everything, including this call, with a timeout
    }, entry.timeoutMs);
  }

  private setProgress(raw: BootProgress | null) {
    // The runtime files are cached after the first boot, so a restart is not a download.
    const progress = raw && this.restarted ? { ...raw, label: 'Restarting Python' } : raw;
    this.lastProgress = progress;
    this.progressListeners.forEach((listener) => listener(progress));
  }

  private failAll(error: PyodideRuntimeError) {
    this.takePending().forEach((entry) => entry.reject(error));
  }

  /** Detach every in-flight call (cancelling their timers) without settling them. */
  private takePending(): Pending[] {
    const entries = [...this.pending.values()];
    entries.forEach((entry) => { if (entry.timer) clearTimeout(entry.timer); });
    this.pending.clear();
    return entries;
  }

  private teardown(reason: 'timeout' | 'stopped' = 'timeout') {
    const hadWorker = this.worker !== null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.bootPromise = null;
    // Detach the old calls BEFORE notifying listeners: a listener may start a
    // new boot synchronously, and that new request must not be failed with them.
    const orphaned = this.takePending();
    this.setProgress(null);
    this.setState('idle');
    if (hadWorker) this.restarted = true;
    if (hadWorker || orphaned.length > 0) {
      const error = reason === 'stopped'
        ? new PyodideRuntimeError('Run stopped.', 'stopped')
        : new PyodideRuntimeError(
          'The Python engine was restarted because the code took too long to run.',
          'timeout',
        );
      orphaned.forEach((entry) => entry.reject(error));
    }
  }
}

function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('./pyodideWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

/** The app-wide runtime. Tests build their own client with a fake worker. */
export const pyodideRuntime = new PyodideRuntimeClient(createBrowserWorker);
