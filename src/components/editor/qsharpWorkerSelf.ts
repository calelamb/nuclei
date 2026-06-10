/**
 * Worker-side bootstrap for the Q# language service worker.
 *
 * qsharp-lang's worker entry (`qsharp-lang/language-service-worker`) calls
 * `WorkerSelf.onMessage(...)` at module-evaluation time, so the `WorkerSelf`
 * global must exist *before* that module evaluates. This file is imported
 * first by qsharpLanguageServiceWorker.ts — ES module execution order
 * guarantees it runs before the qsharp-lang worker code (verified to hold
 * in Vite's bundled worker output as well).
 *
 * Messages that arrive before qsharp-lang installs its handler are buffered
 * and replayed, so the `init` message (carrying the compiled WASM module
 * from the main thread) is never lost.
 */

interface WorkerSelfLike {
  postMessage(msg: unknown): void;
  onMessage(handler: (e: MessageEvent) => void): void;
}

const pendingMessages: MessageEvent[] = [];
let installedHandler: ((e: MessageEvent) => void) | null = null;

self.onmessage = (e: MessageEvent) => {
  if (installedHandler) {
    installedHandler(e);
  } else {
    pendingMessages.push(e);
  }
};

(globalThis as { WorkerSelf?: WorkerSelfLike }).WorkerSelf = {
  postMessage: (msg: unknown) => self.postMessage(msg),
  onMessage: (handler: (e: MessageEvent) => void) => {
    installedHandler = handler;
    while (pendingMessages.length > 0) {
      handler(pendingMessages.shift() as MessageEvent);
    }
  },
};

export {};
