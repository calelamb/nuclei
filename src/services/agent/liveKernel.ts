import type { KernelLanguage, KernelMessage, KernelResponse } from '../../types/quantum';
import type { KernelPort, ParseOutcome, SimOutcome } from './interfaces';

/**
 * Minimal transport shape SessionKernel needs. The real desktop/web
 * transport (`KernelSession` in ../kernelSession.ts) exposes `send` plus a
 * message callback threaded through its constructor rather than a
 * subscribable `onMessage`; adapting one to the other at the call site is a
 * couple of lines. Keeping the port shape subscription-based here is what
 * makes SessionKernel unit-testable with a bare fake.
 */
export interface KernelTransport {
  send(message: KernelMessage): void | Promise<void>;
  onMessage(handler: (message: KernelResponse) => void): () => void;
}

type PendingKind = 'parse' | 'execute';

interface PendingRequest {
  kind: PendingKind;
  resolve: (outcome: ParseOutcome | SimOutcome) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * KernelPort backed by a live (or fake) serial kernel transport. The kernel
 * processes one message at a time and pushes back exactly one terminal
 * response per request (`snapshot`/`error` for parse, `result`/`error` for
 * execute) — so a simple FIFO queue of pending resolvers, matched by
 * response type and (for errors) phase, is enough to correlate requests
 * with responses without needing request ids on the wire.
 */
export class SessionKernel implements KernelPort {
  private readonly queue: PendingRequest[] = [];
  private readonly unsubscribe: () => void;
  private readonly transport: KernelTransport;
  private readonly timeoutMs: number;

  constructor(transport: KernelTransport, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.unsubscribe = transport.onMessage((msg) => this.handleMessage(msg));
  }

  private dequeueAndResolve(outcome: ParseOutcome | SimOutcome): void {
    const pending = this.queue.shift();
    if (!pending) return;
    clearTimeout(pending.timeoutHandle);
    pending.resolve(outcome);
  }

  private handleMessage(msg: KernelResponse): void {
    const pending = this.queue[0];
    if (!pending) return;

    if (msg.type === 'snapshot' && pending.kind === 'parse') {
      if (msg.data) {
        this.dequeueAndResolve({ ok: true, snapshot: msg.data });
      } else {
        this.dequeueAndResolve({ ok: false, error: 'Kernel returned an empty snapshot.' });
      }
      return;
    }

    if (msg.type === 'result' && pending.kind === 'execute') {
      if (msg.data) {
        this.dequeueAndResolve({ ok: true, result: msg.data });
      } else {
        this.dequeueAndResolve({ ok: false, error: 'Kernel returned an empty result.' });
      }
      return;
    }

    if (msg.type === 'error') {
      const matchesParse = pending.kind === 'parse' && (msg.phase === 'parse' || msg.phase === undefined);
      const matchesExecute =
        pending.kind === 'execute' && (msg.phase === 'execute' || msg.phase === 'python' || msg.phase === undefined);

      if (matchesParse || matchesExecute) {
        this.dequeueAndResolve({ ok: false, error: msg.message, line: null });
      }
    }
    // All other response types (output/stderr/hardware_*) are not relevant
    // to a pending parse/execute request and are ignored here.
  }

  parse(code: string, language: KernelLanguage): Promise<ParseOutcome> {
    return new Promise<ParseOutcome>((resolve) => {
      const entry: PendingRequest = {
        kind: 'parse',
        resolve: resolve as (outcome: ParseOutcome | SimOutcome) => void,
        timeoutHandle: setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          resolve({ ok: false, error: 'Timed out waiting for the kernel to parse.' });
        }, this.timeoutMs),
      };
      this.queue.push(entry);
      void this.transport.send({ type: 'parse', code, language });
    });
  }

  simulate(code: string, shots: number, language: KernelLanguage): Promise<SimOutcome> {
    return new Promise<SimOutcome>((resolve) => {
      const entry: PendingRequest = {
        kind: 'execute',
        resolve: resolve as (outcome: ParseOutcome | SimOutcome) => void,
        timeoutHandle: setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          resolve({ ok: false, error: 'Timed out waiting for the kernel to execute.' });
        }, this.timeoutMs),
      };
      this.queue.push(entry);
      void this.transport.send({ type: 'execute', code, shots, language });
    });
  }

  /** Detach from the transport. Safe to call once; further messages are
   * ignored after disposal. */
  dispose(): void {
    this.unsubscribe();
  }
}
