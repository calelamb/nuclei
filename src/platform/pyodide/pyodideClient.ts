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

type RequestBody = { type: 'init' } | { type: 'call'; fn: RuntimeFunction; args: unknown[] };

interface Pending {
  /** What was posted, so a call that outlives a preview recycle can be sent again. */
  body: RequestBody;
  resolve: (value: string) => void;
  reject: (error: PyodideRuntimeError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  /** Budget for the Python itself; the timer starts when the worker reports `started`. */
  timeoutMs: number | undefined;
  /** Receives each line of live program output for this call. */
  onOutput?: (line: string) => void;
  /** A timeout recycles the worker without the app announcing a restart (live preview). */
  quietRestart?: boolean;
}

export interface CallOptions {
  /** Terminate and restart the worker if the call takes longer than this. */
  timeoutMs?: number;
  /** Called with each line the program prints while it runs (this call only). */
  onOutput?: (line: string) => void;
  /**
   * The call is background work (the live preview): if it overruns, the worker is recycled
   * without a visible restart, so Run stays available and the status bar stays calm.
   */
  quietRestart?: boolean;
}

type ProgressListener = (progress: BootProgress | null) => void;
/** idle = no worker running (never started, or killed after a timeout). */
export type RuntimeState = 'idle' | 'booting' | 'ready';
type StateListener = (state: RuntimeState) => void;
type NoticeListener = (text: string) => void;
type InstallListener = (pkg: string | null) => void;

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
  private readonly installListeners = new Set<InstallListener>();
  private installing: string | null = null;
  private lastProgress: BootProgress | null = null;
  /** True after a worker was killed: the next boot is a restart, not a first download. */
  private restarted = false;
  /** The current teardown/boot cycle was a preview recycle, not something the user should see. */
  private quietRestart = false;
  /** A Stop interrupted a package install: the preview must not start it again until the next Run. */
  private stoppedDuringInstall = false;

  constructor(factory: WorkerFactory) {
    this.factory = factory;
  }

  isReady(): boolean {
    return this.ready;
  }

  getState(): RuntimeState {
    return this.state;
  }

  /** True while the worker is being recycled after a timed-out live-preview call. */
  isQuietRestart(): boolean {
    return this.quietRestart;
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

  /**
   * True after a Stop that cut a package install short, until the next Run. The background preview
   * would otherwise reboot Python and start the same install again, so the status bar, header and
   * results would disagree about whether anything is still installing.
   */
  previewPausedByStop(): boolean {
    return this.stoppedDuringInstall;
  }

  /** Lift the pause without a Run: the code that needed the interrupted install no longer does. */
  releasePreviewPause(): void {
    this.stoppedDuringInstall = false;
  }

  /** The package a lazy install is fetching right now ("Cirq"), or null. */
  currentInstall(): string | null {
    return this.installing;
  }

  onInstall(listener: InstallListener): () => void {
    this.installListeners.add(listener);
    return () => { this.installListeners.delete(listener); };
  }

  private setInstalling(pkg: string | null) {
    if (this.installing === pkg) return;
    this.installing = pkg;
    this.installListeners.forEach((listener) => listener(pkg));
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
        this.quietRestart = false;
      },
      (error: unknown) => {
        this.quietRestart = false;
        // A start that never finished is retried as a plain start, never a "restart".
        this.restarted = false;
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
    return this.request({ type: 'call', fn, args }, options.timeoutMs, options.onOutput, options.quietRestart);
  }

  /** Kill the worker; the next call boots a new one. In-flight calls fail as timeouts. */
  restart(): void {
    this.teardown('timeout');
  }

  /** The user asked to stop the running program: kill the worker, fail the call as stopped. */
  stop(): void {
    if (this.installing !== null) this.stoppedDuringInstall = true;
    this.teardown('stopped');
  }

  private request(
    body: RequestBody,
    timeoutMs?: number,
    onOutput?: (line: string) => void,
    quietRestart?: boolean,
  ): Promise<string> {
    // Only a real run (not the quiet preview parse) lifts the pause.
    if (body.type === 'call' && !quietRestart) this.stoppedDuringInstall = false;
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { body, resolve, reject, timer: null, timeoutMs, onOutput, quietRestart });
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
    if (message.type === 'installing') {
      this.setInstalling(message.active ? message.package : null);
      return;
    }
    if (message.type === 'notice') {
      this.noticeListeners.forEach((listener) => listener(message.text));
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    if (message.type === 'stdout') {
      entry.onOutput?.(message.text);
      return;
    }
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
      // A preview timeout kills only the preview; anything queued behind it runs on the fresh worker.
      if (entry.quietRestart === true) this.teardown('timeout', true, entry);
      else this.teardown('timeout'); // rejects everything, including this call, with a timeout
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

  private teardown(reason: 'timeout' | 'stopped' = 'timeout', quiet = false, previewTimedOut?: Pending) {
    this.quietRestart = quiet;
    const hadWorker = this.worker !== null;
    // Only an engine that had finished booting is "restarting"; a retry after a failed start is just starting.
    const wasReady = this.ready;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.bootPromise = null;
    // Detach the old calls BEFORE notifying listeners: a listener may start a
    // new boot synchronously, and that new request must not be failed with them.
    const detached = this.takePending();
    // After a preview timeout only the preview fails; calls queued behind it are sent again.
    const survivors = previewTimedOut ? detached.filter((entry) => entry !== previewTimedOut) : [];
    const orphaned = previewTimedOut ? [previewTimedOut] : detached;
    this.setProgress(null);
    this.setInstalling(null); // the install died with the worker
    this.setState('idle');
    if (wasReady) this.restarted = true;
    if (hadWorker || orphaned.length > 0) {
      const error = reason === 'stopped'
        ? new PyodideRuntimeError('Run stopped.', 'stopped')
        : new PyodideRuntimeError(
          'The Python engine was restarted because the code took too long to run.',
          'timeout',
        );
      orphaned.forEach((entry) => entry.reject(error));
    }
    if (survivors.length > 0) this.redispatch(survivors);
  }

  /** Re-post calls that were queued on a worker that was recycled underneath them. */
  private redispatch(entries: Pending[]) {
    this.ensureStarted().then(
      () => {
        entries.forEach((entry) => {
          const id = this.nextId++;
          this.pending.set(id, { ...entry, timer: null });
          this.worker?.postMessage({ ...entry.body, id } as WorkerRequest);
        });
      },
      (error: unknown) => {
        const failure = error instanceof PyodideRuntimeError
          ? error
          : new PyodideRuntimeError(LOAD_FAILED_MESSAGE, 'load_failed');
        entries.forEach((entry) => entry.reject(failure));
      },
    );
  }
}

function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('./pyodideWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

/** The app-wide runtime. Tests build their own client with a fake worker. */
export const pyodideRuntime = new PyodideRuntimeClient(createBrowserWorker);
