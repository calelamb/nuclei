/**
 * Q# language service web worker entry.
 *
 * Runs Microsoft's QDK compiler + language service (WASM) off the UI
 * thread. The main-thread side (ensureQsharpLanguageService) creates this
 * worker via Vite's `new Worker(new URL(...), { type: 'module' })` pattern
 * and talks to it through qsharp-lang's worker proxy protocol.
 *
 * Import order matters: the WorkerSelf bootstrap must evaluate before
 * qsharp-lang's worker module, which registers its message handler at
 * module scope. Keep these two imports in this exact order.
 */
import './qsharpWorkerSelf';
import 'qsharp-lang/language-service-worker';
