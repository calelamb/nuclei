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

export type RuntimeErrorCode = 'load_failed' | 'timeout' | 'runtime_error';

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

  /** Kill the worker; the next call boots a new one. */
  restart(): void {
    this.teardown();
  }

  private request(
    body: { type: 'init' } | { type: 'call'; fn: RuntimeFunction; args: unknown[] },
    timeoutMs?: number,
  ): Promise<string> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      const entry: Pending = { resolve, reject, timer: null };
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.teardown(); // rejects everything, including this call, with a timeout
        }, timeoutMs);
      }
      this.pending.set(id, entry);
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
    this.pending.delete(message.id);
    if (entry.timer) clearTimeout(entry.timer);
    if (message.type === 'result') entry.resolve(message.value);
    else entry.reject(new PyodideRuntimeError(
      message.code === 'load_failed' ? LOAD_FAILED_MESSAGE : message.message,
      message.code,
    ));
  }

  private setProgress(progress: BootProgress | null) {
    this.lastProgress = progress;
    this.progressListeners.forEach((listener) => listener(progress));
  }

  private failAll(error: PyodideRuntimeError) {
    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(error);
    }
  }

  private teardown() {
    const hadWorker = this.worker !== null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.bootPromise = null;
    this.setProgress(null);
    this.setState('idle');
    if (hadWorker || this.pending.size > 0) {
      this.failAll(new PyodideRuntimeError(
        'The Python engine was restarted because the code took too long to run.',
        'timeout',
      ));
    }
  }
}

function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('./pyodideWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

/** The app-wide runtime. Tests build their own client with a fake worker. */
export const pyodideRuntime = new PyodideRuntimeClient(createBrowserWorker);
