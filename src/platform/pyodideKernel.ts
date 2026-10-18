/**
 * PyodideKernel — runs Python in the browser via Pyodide (WebAssembly).
 *
 * Provides the same message interface as the native WebSocket kernel:
 * - { type: 'parse', code } → { type: 'snapshot', data }
 * - { type: 'execute', code, shots } → { type: 'result', data }
 *
 * Python itself runs in a shared web worker (see pyodide/pyodideClient), so
 * neither booting the runtime nor running user code blocks the UI thread.
 */
import {
  pyodideRuntime,
  PyodideRuntimeError,
  type PyodideRuntimeClient,
} from './pyodide/pyodideClient';
import { OutputBatcher } from './pyodide/outputBatcher';
import type { RuntimeFunction } from './pyodide/workerProtocol';

type KernelMessage = { type: string; [key: string]: unknown };
type MessageHandler = (msg: KernelMessage) => void;

type Phase = 'parse' | 'execute' | 'python';

/** Live parsing re-runs the program on every pause in typing, so it gets a short leash. */
export const PARSE_TIMEOUT_MS = 5_000;
export const EXECUTE_TIMEOUT_MS = 120_000;

const DESKTOP_HINT = 'Open this in the Nuclei desktop app (getnuclei.dev) for full framework support.';

interface RuntimeReply {
  snapshot?: unknown;
  result?: unknown;
  output?: string;
  error?: string | null;
}

/**
 * Turn raw Python error text into something a student can act on:
 * browser-subset limits and missing frameworks point at the desktop app.
 */
function translateModuleError(errorMsg: string): string {
  const unsupported = errorMsg.replace(/(?:_nuclei_unsupported\.)?UnsupportedInBrowser: /g, '');
  if (unsupported !== errorMsg) return unsupported;

  const match = errorMsg.match(
    /ModuleNotFoundError: No module named '(qiskit|pennylane|qutip|cudaq|cirq)'/,
  );
  if (!match) return errorMsg;

  const names: Record<string, string> = {
    qiskit: 'Qiskit', cudaq: 'CUDA-Q', cirq: 'Cirq', pennylane: 'PennyLane', qutip: 'QuTiP',
  };
  return `${names[match[1]]} isn't available in the browser version. ${DESKTOP_HINT}`;
}

function classifyKernelError(message: string): { code: string } {
  if (message.includes('UnsupportedInBrowser')) return { code: 'unsupported_framework' };
  if (message.includes('No supported quantum framework detected')) return { code: 'unsupported_framework' };
  if (message.includes('No circuit found')) return { code: 'no_circuit' };
  if (message.includes('ModuleNotFoundError')) return { code: 'missing_dependency' };
  if (message.includes('timed out')) return { code: 'timeout' };
  return { code: 'execution_error' };
}

function lastLine(text: string): string {
  return text.split('\n').filter(Boolean).pop() ?? text;
}

export class PyodideKernel {
  private readonly onMessage: MessageHandler;
  private readonly runtime: PyodideRuntimeClient;

  constructor(onMessage: MessageHandler, runtime: PyodideRuntimeClient = pyodideRuntime) {
    this.onMessage = onMessage;
    this.runtime = runtime;
  }

  /** Boot (or join the boot of) the shared Python runtime. Rejects if it cannot load. */
  async init(): Promise<void> {
    await this.runtime.ensureStarted();
  }

  isReady(): boolean {
    return this.runtime.isReady();
  }

  async send(msg: KernelMessage): Promise<void> {
    // Q# has no browser runtime yet — reject before touching Pyodide so the
    // user gets a clear "desktop only" message instead of a Python traceback.
    if (msg.language === 'qsharp' && (msg.type === 'parse' || msg.type === 'execute')) {
      this.rejectQsharp(msg.type);
      return;
    }
    // A live-preview parse arriving while Python (re)boots is simply skipped:
    // the next edit after boot re-parses, and nothing should reach the user.
    if (msg.type === 'parse' && !this.runtime.isReady()) return;
    if (msg.type === 'parse') await this.parse(msg.code as string);
    else if (msg.type === 'execute') await this.execute(msg.code as string, msg);
    else if (msg.type === 'run_python') await this.runPython(msg.code as string);
  }

  private rejectQsharp(phase: 'parse' | 'execute') {
    this.onMessage({ type: 'snapshot', data: null });
    if (phase === 'execute') this.onMessage({ type: 'result', data: null });
    this.onMessage({
      type: 'error',
      message:
        'Q# runs in the desktop app today. Download Nuclei for macOS/Windows/Linux to use the QDK — web support is coming.',
      phase,
      code: 'unsupported_framework',
    });
  }

  private async callRuntime(
    fn: RuntimeFunction,
    args: unknown[],
    timeoutMs: number,
    forwardNotices: boolean,
  ): Promise<RuntimeReply> {
    await this.runtime.ensureStarted();
    const unsubscribe = forwardNotices
      ? this.runtime.onNotice((text) => this.onMessage({ type: 'output', text: `${text}\n` }))
      : () => {};
    const output = new OutputBatcher((text) => this.onMessage({ type: 'output', text }));
    try {
      const raw = await this.runtime.call(fn, args, { timeoutMs, onOutput: output.push, quietRestart: fn === 'nuclei_parse' });
      return JSON.parse(raw) as RuntimeReply;
    } finally {
      unsubscribe();
      output.flush();
    }
  }

  private emitError(phase: Phase, raw: string, code?: string) {
    const translated = translateModuleError(raw);
    this.onMessage({
      type: 'error',
      message: lastLine(translated),
      traceback: translated,
      phase,
      code: code ?? classifyKernelError(raw).code,
    });
  }

  private endedByStop(error: unknown): boolean {
    return error instanceof PyodideRuntimeError && error.code === 'stopped';
  }

  private emitCallFailure(phase: Phase, error: unknown) {
    if (error instanceof PyodideRuntimeError && error.code === 'timeout') {
      const seconds = (phase === 'parse' ? PARSE_TIMEOUT_MS : EXECUTE_TIMEOUT_MS) / 1000;
      this.emitError(phase, `Your code ran for more than ${seconds} seconds and was stopped. Python is restarting.`, 'timeout');
      return;
    }
    this.emitError(phase, error instanceof Error ? error.message : String(error));
  }

  private async parse(code: string) {
    try {
      const data = await this.callRuntime('nuclei_parse', [code], PARSE_TIMEOUT_MS, false);
      // Parse runs the user's program, so anything it printed is preview noise
      // from half-typed code: tag it so consumers keep it out of the Terminal.
      if (data.output) this.onMessage({ type: 'output', text: data.output, phase: 'parse' });
      this.onMessage({ type: 'snapshot', data: data.snapshot ?? null });
      if (data.error) this.emitError('parse', data.error);
    } catch (error) {
      if (this.endedByStop(error)) return;
      this.onMessage({ type: 'snapshot', data: null });
      this.emitCallFailure('parse', error);
    }
  }

  private async execute(code: string, msg: KernelMessage) {
    const shots = typeof msg.shots === 'number' ? msg.shots : 1024;
    const seed = typeof msg.seed === 'number' ? msg.seed : undefined;
    try {
      const data = await this.callRuntime('nuclei_execute', [code, shots, seed], EXECUTE_TIMEOUT_MS, true);
      if (data.output) this.onMessage({ type: 'output', text: data.output });
      if (data.snapshot || data.error) this.onMessage({ type: 'snapshot', data: data.snapshot ?? null });
      if (data.error) {
        this.onMessage({ type: 'result', data: null });
        this.emitError('execute', data.error);
      } else {
        this.onMessage({ type: 'result', data: data.result ?? null });
      }
    } catch (error) {
      if (this.endedByStop(error)) {
        this.onMessage({ type: 'result', data: null, stopped: true });
        return;
      }
      this.onMessage({ type: 'snapshot', data: null });
      this.onMessage({ type: 'result', data: null });
      this.emitCallFailure('execute', error);
    }
  }

  private async runPython(code: string) {
    try {
      const data = await this.callRuntime('nuclei_run_python', [code], EXECUTE_TIMEOUT_MS, true);
      if (data.output) this.onMessage({ type: 'output', text: data.output });
      if (data.error) this.emitError('python', data.error);
      this.onMessage({ type: 'python_result', success: !data.error });
    } catch (error) {
      if (this.endedByStop(error)) this.onMessage({ type: 'output', text: 'Run stopped.\n' });
      else this.emitCallFailure('python', error);
      this.onMessage({ type: 'python_result', success: false });
    }
  }
}
