/**
 * PRD 14 — kernel sessions for the Quantum AI Lab (Trainability Lab and
 * Discovery Engine).
 *
 * Each Lab surface opens its own dedicated WebSocket session, so long jobs
 * never queue behind the editor's parse/execute traffic. The kernel handles
 * one message at a time per connection, and every Lab long job acks at once
 * and streams the rest of its output.
 *
 * The Lab needs the native Python kernel (numpy statevector analyses, Stim,
 * sandbox subprocesses), so the web build reports it as unavailable. The
 * DEV-only `?labKernel=ws://host:port` override points a plain browser at a
 * real kernel for e2e runs and screenshots.
 */

import { KERNEL_WS_URL } from '../../config/kernel';
import type { KernelMessage, KernelResponse } from '../../types/quantum';
import type { RunnerKernelSession } from '../experimentRunner';

export type LabPlatform = 'desktop' | 'web';

export interface LabSession extends RunnerKernelSession {
  close(): void;
  /** True once the socket has closed (kernel stopped, or `close()` called). */
  readonly closed: boolean;
  /** Subscribe to the socket closing; returns an unsubscribe fn. */
  onClose(handler: () => void): () => void;
}

export type LabAvailability =
  | { available: true; url: string }
  | { available: false; reason: 'web_build' };

export class LabUnavailableError extends Error {
  constructor(message = 'The Quantum AI Lab needs the desktop Python kernel.') {
    super(message);
    this.name = 'LabUnavailableError';
  }
}

function devKernelOverride(): string | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  try {
    const value = new URLSearchParams(window.location.search).get('labKernel');
    if (value && /^wss?:\/\/[\w.-]+(:\d+)?\/?$/.test(value)) return value;
  } catch {
    // Non-browser environment (tests); fall through.
  }
  return null;
}

export function labAvailability(platform: LabPlatform): LabAvailability {
  const override = devKernelOverride();
  if (override) return { available: true, url: override };
  if (platform === 'desktop') return { available: true, url: KERNEL_WS_URL };
  return { available: false, reason: 'web_build' };
}

/** Injected for tests; production uses the browser WebSocket. */
export type WebSocketFactory = (url: string) => WebSocket;

export async function openLabSession(
  platform: LabPlatform,
  createSocket: WebSocketFactory = (url) => new WebSocket(url),
): Promise<LabSession> {
  const availability = labAvailability(platform);
  if (!availability.available) throw new LabUnavailableError();

  const handlers = new Set<(message: KernelResponse) => void>();
  const closeHandlers = new Set<() => void>();
  let closed = false;

  const socket = createSocket(availability.url);

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      socket.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      socket.removeEventListener('open', onOpen);
      reject(new Error(`Could not connect to the kernel at ${availability.url}`));
    };
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    let message: KernelResponse;
    try {
      message = JSON.parse(String(event.data)) as KernelResponse;
    } catch {
      message = { type: 'error', message: 'Failed to parse kernel response' };
    }
    for (const handler of [...handlers]) handler(message);
  });
  socket.addEventListener('close', () => {
    closed = true;
    for (const handler of [...closeHandlers]) handler();
  });

  return {
    send(message: KernelMessage) {
      if (closed || socket.readyState !== 1) {
        throw new Error('Kernel session is closed');
      }
      socket.send(JSON.stringify(message));
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch {
        // Already closing.
      }
      for (const handler of [...closeHandlers]) handler();
    },
  };
}

/**
 * Await the first response matching `match` (or a kernel `error` matching
 * `matchError`). Resolves `{ error }` rather than rejecting on kernel errors,
 * which is the house style for correlated request/response (see
 * `collectSimulatorRun`). Rejects only on timeout or a closed session.
 */
export function request<T extends KernelResponse>(
  session: LabSession,
  message: KernelMessage,
  match: (response: KernelResponse) => response is T,
  options: {
    timeoutMs?: number;
    matchError?: (error: Extract<KernelResponse, { type: 'error' }>) => boolean;
  } = {},
): Promise<{ ok: true; value: T } | { ok: false; error: Extract<KernelResponse, { type: 'error' }> }> {
  const { timeoutMs = 30_000, matchError = () => true } = options;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      unsubscribe();
      offClose();
      clearTimeout(timer);
    };
    const unsubscribe = session.subscribe((response) => {
      if (settled) return;
      if (match(response)) {
        finish();
        resolve({ ok: true, value: response });
      } else if (response.type === 'error' && matchError(response)) {
        finish();
        resolve({ ok: false, error: response });
      }
    });
    const offClose = session.onClose(() => {
      if (settled) return;
      finish();
      reject(new Error('Kernel session closed'));
    });
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error(`Kernel did not answer ${message.type} within ${timeoutMs} ms`));
    }, timeoutMs);
    try {
      void Promise.resolve(session.send(message)).catch((error: unknown) => {
        if (settled) return;
        finish();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      finish();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
