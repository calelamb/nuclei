import type { KernelEnvironment, KernelMessage, KernelResponse } from '../types/quantum';

/**
 * PRD 09 Phase C (C4) — cached `environment` fetch.
 *
 * The kernel's package/interpreter versions barely change during a session, so
 * we fetch them once and cache. `resetEnvironmentCache()` is called on kernel
 * restart so a re-provisioned venv is re-read. Injected transport keeps this
 * testable without a live WebSocket.
 */

export interface EnvironmentTransport {
  send(message: KernelMessage): void | Promise<void>;
  subscribe(handler: (message: KernelResponse) => void): () => void;
}

let cached: KernelEnvironment | null = null;
let inFlight: Promise<KernelEnvironment | null> | null = null;

const DEFAULT_TIMEOUT_MS = 5000;

/** Discard the cached environment (call on kernel restart). */
export function resetEnvironmentCache(): void {
  cached = null;
  inFlight = null;
}

/**
 * Fetch the kernel environment, caching the first successful result. Returns
 * null on timeout/transport failure — the runner treats a missing environment
 * as "versions unknown" rather than failing the sweep.
 */
export function fetchEnvironment(
  transport: EnvironmentTransport,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<KernelEnvironment | null> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = new Promise<KernelEnvironment | null>((resolve) => {
    let settled = false;
    const finish = (value: KernelEnvironment | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (value) cached = value;
      inFlight = null;
      resolve(value);
    };

    const unsubscribe = transport.subscribe((msg) => {
      if (msg.type === 'environment') {
        const { python, platform, packages } = msg;
        finish({ python, platform, packages });
      }
    });

    const timer = setTimeout(() => finish(null), timeoutMs);

    Promise.resolve(transport.send({ type: 'environment' })).catch(() => finish(null));
  });

  return inFlight;
}
