import { useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useSettingsStore } from '../stores/settingsStore';
import { kernelLanguageFor } from '../types/quantum';
import type { KernelLanguage, KernelResponse } from '../types/quantum';
import { KERNEL_WS_URL } from '../config/kernel';
import {
  CLOSE_UNAUTHENTICATED,
  KERNEL_AUTH_REJECTED_MESSAGE,
  KernelAuthRejectedError,
  openKernelConnection,
} from '../services/kernelSocket';
import type { PyodideKernel } from '../platform/pyodideKernel';
import type { PyodideRuntimeClient } from '../platform/pyodide/pyodideClient';
import { KERNEL_NOT_RESPONDING_MESSAGE, normalizeKernelError } from '../lib/kernelErrors';
import { registerKernelRetry } from '../lib/kernelControl';
import { useDiracStore } from '../stores/diracStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useQecStore } from '../stores/qecStore';
import { useQecEstimateStore } from '../stores/qecEstimateStore';
import { useQecExplainStore } from '../stores/qecExplainStore';
import { applyQecExplainResult, applyQecExplainError, explainSizeError } from '../lib/qecExplainMessages';
import { sendPostAuthMessages } from './kernelPostAuth';
import { setQecExplainSender, type QecExplainAnalysis } from '../lib/qecExplainSender';
import { useMissingDependencyStore } from '../stores/missingDependencyStore';
import { setQecDecodeSender, setQecSnapshotSender, setQecEstimateSender } from '../lib/qecDecodeSender';
import { setTranspileSender } from '../lib/transpileSender';
import { useTranspileStore } from '../stores/transpileStore';
import { setDebugTraceSender } from '../lib/debugTraceSender';
import { useDebugStore } from '../stores/debugStore';
import { setLintSender, setFormatSender, resolveFormat } from '../lib/lintSender';
import { useLintStore } from '../stores/lintStore';
import { narrateParse, narrateResult } from '../services/narration';
import { rewriteExecutionError } from '../services/errorRewrite';
import { computeNextPollDelayMs, STALE_AFTER_MS } from '../lib/pollSchedule';

const KERNEL_URL = KERNEL_WS_URL;

/** How long to wait for a `hardware_connected` reply before giving up on a
 * connect attempt (provider auth can hang without ever answering). */
export const HARDWARE_CONNECT_TIMEOUT_MS = 45_000;

const DEFAULT_DEBOUNCE_MS = 300;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 15;

export function getErrorContext(msg: Extract<KernelResponse, { type: 'error' }>) {
  const detail = msg.traceback ?? msg.message;
  const frames = detail.match(/File "<(?:string|exec)>", line (\d+)/g) || [];
  const lastFrame = frames[frames.length - 1];
  const lineMatch = lastFrame?.match(/line (\d+)/);
  let line = lineMatch ? parseInt(lineMatch[1], 10) : null;

  // Q# compile errors arrive as miette-rendered spans like `,-[line_0:3:11]`
  // (file:line:col, 1-based line within the buffer). Fall back to that when
  // no Python traceback frame matched.
  if (line === null) {
    const qsharpSpan = detail.match(/\[line_\d+:(\d+):\d+\]/);
    if (qsharpSpan) line = parseInt(qsharpSpan[1], 10);
  }

  return {
    detail,
    line,
    shortMessage: detail.split('\n').filter(Boolean).pop() ?? msg.message,
  };
}

export function useKernel() {
  const wsRef = useRef<WebSocket | null>(null);
  const pyodideRef = useRef<PyodideKernel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const explainSeqRef = useRef(0);
  const runtimeSubscriptionsRef = useRef<Array<() => void>>([]);
  // Per-provider "connecting" watchdogs: a hardware_connect that's sent but
  // never answered (provider auth hangs) would leave the UI stuck on
  // "Connecting…" forever. Each connect arms a timer here; the
  // hardware_connected handler clears it.
  const connectTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const setSnapshot = useCircuitStore.getState().setSnapshot;
  const setCircuitError = useCircuitStore.getState().setError;
  const clearEditorErrors = useEditorStore.getState().clearErrors;
  const clearSimulationResult = useSimulationStore.getState().clearResult;

  const handleMessage = useCallback((msg: KernelResponse) => {
    switch (msg.type) {
      case 'snapshot':
        setSnapshot(msg.data);
        clearEditorErrors();
        // Non-stim circuits have no QEC sidecar — drop any stale one so the
        // detector graph / lattice don't flash old data on a framework swap.
        if (!msg.data || msg.data.framework !== 'stim') {
          useQecStore.getState().clear();
        }
        if (msg.data) {
          // Every parse/execute send is tagged with an explicit `language`,
          // so the kernel can never legitimately return a snapshot whose
          // framework crosses the python<->qsharp boundary relative to the
          // framework we currently hold. A cross-boundary snapshot is a
          // stale response from the previous buffer (e.g. a Python parse
          // landing after a .qs tab eagerly set framework='qsharp') — drop
          // that feedback, but keep within-family qiskit<->cirq<->cuda-q
          // refinement working as before.
          const currentFramework = useEditorStore.getState().framework;
          if (kernelLanguageFor(msg.data.framework) === kernelLanguageFor(currentFramework)) {
            useEditorStore.getState().setFramework(msg.data.framework);
          }
          useDiracStore.getState().clearRewrittenError();
          if (useSettingsStore.getState().dirac.narration) {
            const codeForNarration = useEditorStore.getState().code;
            narrateParse({ code: codeForNarration, snapshot: msg.data })
              .then((line) => {
                if (line) useDiracStore.getState().pushAmbient({ kind: 'parse', text: line });
              })
              .catch(() => { /* graceful — ambient AI must never throw */ });
          }
        }
        break;
      case 'result':
        useSimulationStore.getState().setResult(msg.data);
        clearEditorErrors();
        if (msg.data) {
          useDiracStore.getState().clearRewrittenError();
          if (useSettingsStore.getState().dirac.narration) {
            const codeForNarration = useEditorStore.getState().code;
            const snap = useCircuitStore.getState().snapshot;
            narrateResult({ code: codeForNarration, snapshot: snap, result: msg.data })
              .then((line) => {
                if (line) useDiracStore.getState().pushAmbient({ kind: 'result', text: line });
              })
              .catch(() => { /* graceful */ });
          }
        }
        break;
      case 'python_result':
        useSimulationStore.getState().setRunning(false);
        clearEditorErrors();
        break;
      case 'environment':
        // Protocol v1.1 (PRD 09 Phase B) — the fetch/consume side (caching
        // per session, stamping experiment manifests) is Phase C. For now
        // this is a recognized no-op so the switch never falls through to
        // an "unhandled message type" surprise.
        break;
      case 'qec_snapshot':
        // Protocol v1.2 (PRD 10) — the coords + DEM sidecar for Stim circuits,
        // arriving after the mapped `snapshot`. Stash it (with the source that
        // produced it, for decode-sample requests) for the QEC viz panels.
        useQecStore.getState().setSnapshot(msg.data, useEditorStore.getState().code);
        break;
      case 'qec_decode_sample':
        // Response to the detector graph's "Sample a shot" request.
        useQecStore.getState().setDecodeSample({
          num_detectors: msg.num_detectors,
          syndrome: msg.syndrome,
          matched_edges: msg.matched_edges,
          predicted_observable_flips: msg.predicted_observable_flips,
          actual_observable_flips: msg.actual_observable_flips,
        });
        break;
      case 'qec_estimate_result':
        useQecEstimateStore.getState().setResult(msg.data);
        break;
      case 'qec_explain_result':
        applyQecExplainResult(msg.data, msg.request_id);
        break;
      case 'transpile_result':
        // Dev tools Phase 1 — Transpiler Explorer. A null payload means an
        // `error` with phase 'transpile' already arrived and set the store's
        // error; don't overwrite it with an empty success.
        if (msg.data) useTranspileStore.getState().setResult(msg.data);
        break;
      case 'debug_trace_result':
        // Dev tools Phase 3 — Quantum Debugger. Null means a phase-'debug'
        // error already set the store's error.
        if (msg.data) useDebugStore.getState().setTrace(msg.data);
        break;
      case 'lint_result':
        // Dev tools Phase 4 — ruff diagnostics for the active buffer.
        useLintStore.getState().setDiagnostics(msg.diagnostics);
        break;
      case 'format_result':
        // Dev tools Phase 4 — resolve the awaiting formatting provider (null
        // when the format failed, which makes no edit).
        resolveFormat(msg.formatted);
        break;
      case 'output':
        // Live-preview (parse) output is noise from half-typed code: drop it.
        if (msg.phase === 'parse') break;
        useSimulationStore.getState().addOutput(msg.text, 'stdout');
        useBottomPanelStore.getState().focusTerminal();
        break;
      case 'stderr':
        if (msg.phase === 'parse') break;
        useSimulationStore.getState().addOutput(msg.text, 'stderr');
        useBottomPanelStore.getState().focusTerminal();
        break;
      case 'error': {
        // Resource-estimate failures belong to the Estimator panel, not the
        // terminal/editor error surfaces (PRD 10 Phase F).
        if (msg.phase === 'qec_estimate') {
          useQecEstimateStore.getState().setError(msg.message);
          break;
        }

        // Circuit Explain failures render inside that panel (visible, with the
        // kernel's message), not in the terminal/editor surfaces.
        if (msg.phase === 'qec_explain') {
          applyQecExplainError(msg.message, msg.request_id);
          break;
        }

        // Transpiler Explorer failures belong to that panel, not the
        // terminal/editor error surfaces (dev tools Phase 1).
        if (msg.phase === 'transpile') {
          useTranspileStore.getState().setError(msg.message);
          break;
        }

        // Quantum Debugger failures belong to the debugger panels (Phase 3).
        if (msg.phase === 'debug') {
          useDebugStore.getState().setError(msg.message);
          break;
        }

        // Editor lint/format failures (Phase 4) are non-fatal and must not hit
        // the terminal/editor error surfaces. A format error unblocks the
        // awaiting provider (no edit); a lint error is simply ignored.
        if (msg.phase === 'format') {
          resolveFormat(null);
          break;
        }
        if (msg.phase === 'lint') {
          break;
        }

        // A missing framework is recoverable in one click — surface it to the
        // install banner (still falls through to the normal error handling so
        // the terminal shows the traceback too).
        if (msg.code === 'missing_dependency' && msg.dependency) {
          useMissingDependencyStore.getState().report(msg.dependency, msg.framework ?? null);
        }

        const { detail, line, shortMessage } = getErrorContext(msg);

        // A parse error is the live preview tripping over half-typed code: it
        // belongs on the editor (marker + circuit panel), never in the Terminal,
        // and it must not cancel a run that happens to be in flight.
        const isParseError = msg.phase === 'parse';
        if (!isParseError) {
          useSimulationStore.getState().addOutput(`Error: ${detail}`, 'stderr');
          useSimulationStore.getState().setRunning(false);
          useBottomPanelStore.getState().focusTerminal();
        }

        if (!isParseError && useSettingsStore.getState().dirac.autoExplainErrors) {
          const codeForRewrite = useEditorStore.getState().code;
          const framework = useEditorStore.getState().framework;
          rewriteExecutionError({ code: codeForRewrite, framework, traceback: detail })
            .then((rewritten) => {
              if (rewritten) {
                useDiracStore.getState().setRewrittenError({
                  explanation: rewritten.explanation,
                  fix: rewritten.fix,
                  originalTraceback: detail,
                });
              }
            })
            .catch(() => { /* graceful — app still works without a rewrite */ });
        }

        if (msg.phase === 'parse') {
          setSnapshot(null);
          setCircuitError(msg.message);
        }

        if (msg.phase === 'execute' || msg.phase === 'python') {
          clearSimulationResult();
          if (msg.phase === 'execute') {
            setCircuitError(msg.message);
          }
        }

        if (line !== null) {
          useEditorStore.getState().setErrors([{ line, message: shortMessage }]);
        }
        break;
      }
      case 'hardware_connected': {
        const hw = useHardwareStore.getState();
        // The provider answered — cancel its connect watchdog.
        clearTimeout(connectTimersRef.current[msg.provider]);
        delete connectTimersRef.current[msg.provider];
        hw.setConnecting(null);
        if (msg.success) {
          hw.setProviderConnected(msg.provider as never, true);
          hw.setConnectionError(msg.provider as never, null);
        } else {
          hw.setProviderConnected(msg.provider as never, false);
          hw.setConnectionError(
            msg.provider as never,
            `Could not connect to ${msg.provider}. Check the token and try again.`,
          );
        }
        break;
      }
      case 'hardware_connected_providers': {
        // Kernel just told us which providers it has an active connection
        // to — mirror that into the store so the UI accurately reflects the
        // post-restart auto-reconnect state instead of assuming "everything
        // disconnected" on a fresh page load.
        const hw = useHardwareStore.getState();
        for (const p of msg.providers) {
          hw.setProviderConnected(p as never, true);
        }
        break;
      }
      case 'hardware_jobs': {
        // Kernel's persistent job registry. Non-terminal entries come
        // back as 'stale' because the SDK handle didn't survive the
        // restart — users see their history and can re-submit.
        const hw = useHardwareStore.getState();
        hw.setJobs(msg.jobs.map((j) => ({
          id: j.id,
          provider: j.provider,
          backend: j.backend,
          submittedAt: j.submitted_at,
          status: j.status,
          queuePosition: j.queue_position ?? null,
          shots: j.shots,
          error: j.error ?? null,
        })));
        break;
      }
      case 'hardware_job_submitted': {
        useHardwareStore.getState().addJob({
          id: msg.job.id,
          provider: msg.job.provider,
          backend: msg.job.backend,
          submittedAt: msg.job.submitted_at,
          status: msg.job.status,
          queuePosition: msg.job.queue_position ?? null,
          shots: msg.job.shots,
        });
        break;
      }
      case 'hardware_job_update': {
        const j = msg.job;
        useHardwareStore.getState().updateJob(j.id, {
          status: j.status,
          queuePosition: j.queue_position ?? null,
        });
        break;
      }
      case 'hardware_result': {
        // Kernel returns {measurements: {state: count}, ...}. Convert the
        // counts into normalized probabilities so the dual-bar chip can
        // render them side-by-side with the classical simulator.
        const counts = msg.data?.measurements ?? {};
        const total = Object.values(counts).reduce((a, b) => a + (b as number), 0) || 1;
        const probs: Record<string, number> = {};
        for (const [k, v] of Object.entries(counts)) {
          probs[k] = (v as number) / total;
        }
        const jobs = useHardwareStore.getState().jobs;
        const j = jobs.find((x) => x.id === msg.job_id);
        useHardwareStore.getState().setResult(msg.job_id, {
          jobId: msg.job_id,
          measurements: counts,
          probabilities: probs,
          executionTimeMs: 0,
          backend: j?.backend ?? 'unknown',
        });
        useHardwareStore.getState().updateJob(msg.job_id, { status: 'complete' });
        break;
      }
      case 'hardware_job_cancelled': {
        useHardwareStore.getState().updateJob(msg.job_id, { status: 'failed' });
        break;
      }
      case 'hardware_job_dismissed': {
        // Usually a no-op: hardwareDismiss() already cleared the job
        // optimistically. The ack covers dismissals initiated elsewhere
        // (e.g. another window sharing the kernel).
        useHardwareStore.getState().clearJob(msg.job_id);
        break;
      }
      case 'hardware_backends': {
        // Normalize kernel field names (snake_case) into the TS shape
        // (camelCase) the store + LaunchModal expect.
        interface RawBackend {
          name?: unknown;
          provider?: unknown;
          qubit_count?: unknown;
          connectivity?: unknown;
          queue_length?: unknown;
          average_error_rate?: unknown;
          gate_set?: unknown;
          status?: unknown;
        }
        const normalized = (msg.backends as RawBackend[]).map((b) => ({
          name: String(b.name ?? ''),
          provider: String(b.provider ?? '') as never,
          qubitCount: Number(b.qubit_count ?? 0),
          connectivity: (Array.isArray(b.connectivity) ? b.connectivity : []).map(
            (pair: unknown) => {
              const arr = pair as [number, number];
              return [arr[0], arr[1]] as [number, number];
            },
          ),
          queueLength: Number(b.queue_length ?? 0),
          averageErrorRate: Number(b.average_error_rate ?? 0),
          gateSet: Array.isArray(b.gate_set) ? (b.gate_set as string[]) : [],
          status: (b.status as 'online' | 'offline' | 'maintenance') ?? 'online',
        }));
        useHardwareStore.getState().setBackends(normalized);
        break;
      }
    }
  }, [clearEditorErrors, clearSimulationResult, setSnapshot, setCircuitError]);

  // WebSocket connection for desktop. We connect optimistically; if the
  // kernel hasn't opened its port yet, `onerror` fires fast and we retry on
  // a short cadence until the probe budget is exhausted.
  const failAuthRejected = useCallback(() => {
    if (!mountedRef.current) return;
    // Both the close event and the auth promise report this; say it once.
    if (useEditorStore.getState().kernelError === KERNEL_AUTH_REJECTED_MESSAGE) return;
    useEditorStore.getState().setKernelConnected(false);
    useEditorStore.getState().setKernelReady(false);
    useEditorStore.getState().setKernelStatus('failed', KERNEL_AUTH_REJECTED_MESSAGE);
    useSimulationStore.getState().addOutput(`Error: ${KERNEL_AUTH_REJECTED_MESSAGE}`, 'stderr');
  }, []);

  /** Surface a start/connect failure once: status chip, banner state, and the Terminal. */
  const failKernel = useCallback((message: string) => {
    useEditorStore.getState().setKernelConnected(false);
    useEditorStore.getState().setKernelReady(false);
    useEditorStore.getState().setKernelStatus('failed', message);
    useSimulationStore.getState().addOutput(`Error: ${message}`, 'stderr');
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current || isWeb) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    useEditorStore.getState().setKernelStatus('connecting');

    const getToken = platform.getKernelAuthToken?.bind(platform);
    void openKernelConnection(KERNEL_URL, getToken).then(({ ws, authenticated }) => {
      if (!mountedRef.current) { ws.close(); return; }
      ws.onopen = () => { wsRef.current = ws; };

      // "Connected" means the kernel accepted our token, not merely that the
      // socket opened: a rejected session must never look ready.
      const onAuthenticated = () => {
        if (!mountedRef.current) { ws.close(); return; }
        retryCountRef.current = 0;
        useEditorStore.getState().setKernelConnected(true);
        useEditorStore.getState().setKernelReady(true);
        useEditorStore.getState().setKernelStatus('ready');
        sendPostAuthMessages(ws);
      };

      authenticated.then(onAuthenticated, (error: unknown) => {
        if (error instanceof KernelAuthRejectedError) failAuthRejected();
        else if (mountedRef.current && ws.readyState === WebSocket.OPEN) ws.close();
      });

      ws.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data));
        } catch (e) {
          if (import.meta.env.DEV) console.error('[Nuclei] Failed to parse kernel message:', e);
        }
      };

      ws.onclose = (event) => {
        wsRef.current = null;
        // A pending explain will never get its reply; say so instead of spinning.
        useQecExplainStore.getState().failPending(
          'The kernel connection was lost before the analysis finished. Reconnect and run it again.',
        );
        useEditorStore.getState().setKernelConnected(false);
        if (!mountedRef.current) return;
        // A rejected token will be rejected again: report it, don't loop.
        if (event.code === CLOSE_UNAUTHENTICATED) { failAuthRejected(); return; }

        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          const attempt = retryCountRef.current;
          useEditorStore.getState().setKernelStatus('connecting');
          useEditorStore.getState().setKernelProgress({
            step: attempt,
            total: MAX_RETRIES,
            label: `Connecting to the kernel (${attempt}/${MAX_RETRIES})`,
            fraction: attempt / MAX_RETRIES,
          });
          setTimeout(connect, RETRY_DELAY_MS);
        } else {
          failKernel(KERNEL_NOT_RESPONDING_MESSAGE);
        }
      };

      ws.onerror = () => { ws.close(); };
    });
  }, [failAuthRejected, failKernel, handleMessage, isWeb, platform]);


  const markWebReady = useCallback(() => {
    const editor = useEditorStore.getState();
    editor.setKernelConnected(true);
    editor.setKernelReady(true);
    editor.setKernelStatus('ready');
  }, []);

  /** Keep the status chip truthful across boots and worker restarts. */
  const watchRuntime = useCallback((runtime: PyodideRuntimeClient) => {
    runtimeSubscriptionsRef.current.forEach((off) => off());
    let wasReady = runtime.isReady();
    const offProgress = runtime.onProgress((progress) => {
      if (progress) useEditorStore.getState().setKernelProgress(progress);
    });
    const offState = runtime.onState((state) => {
      if (!mountedRef.current) return;
      const editor = useEditorStore.getState();
      if (state === 'booting') {
        editor.setKernelConnected(false);
        editor.setKernelReady(false);
        editor.setKernelStatus('connecting');
      } else if (state === 'ready') {
        wasReady = true;
        markWebReady();
      } else if (wasReady) {
        // The worker was killed (runaway code): boot a fresh one right away.
        wasReady = false;
        runtime.ensureStarted().catch((e: unknown) => failKernel(normalizeKernelError(e)));
      }
    });
    // A lazy install (Cirq) triggered by the live preview explains the pause;
    // during a Run the kernel forwards the same notice as ordinary output.
    const offNotice = runtime.onNotice((text) => {
      if (!useSimulationStore.getState().isRunning) useSimulationStore.getState().addOutput(text, 'info');
    });
    runtimeSubscriptionsRef.current = [offProgress, offState, offNotice];
  }, [failKernel, markWebReady]);

  // Web: boot the shared Pyodide worker and mirror its state into the editor
  // store (status chip, progress stages, restart after a runaway program).
  const initPyodide = useCallback(async () => {
    if (!isWeb) return;
    runtimeSubscriptionsRef.current.forEach((off) => off());
    runtimeSubscriptionsRef.current = [];

    const editor = useEditorStore.getState();
    editor.setKernelConnected(false);
    editor.setKernelReady(false);
    editor.setKernelStatus('connecting');

    try {
      const { PyodideKernel } = await import('../platform/pyodideKernel');
      const { pyodideRuntime } = await import('../platform/pyodide/pyodideClient');
      if (!mountedRef.current) return;
      watchRuntime(pyodideRuntime);

      const kernel = new PyodideKernel((msg) => handleMessage(msg as KernelResponse));
      await kernel.init();
      if (!mountedRef.current) return;
      pyodideRef.current = kernel;
      markWebReady();

      // Initial parse of whatever is in the editor (never rewrites it).
      const { code, framework, filePath } = useEditorStore.getState();
      if (code.trim()) {
        void kernel.send({ type: 'parse', code, language: kernelLanguageFor(framework, filePath) });
      }
    } catch (e) {
      if (mountedRef.current) failKernel(normalizeKernelError(e));
    }
  }, [failKernel, handleMessage, isWeb, markWebReady, watchRuntime]);

  const startDesktopKernel = useCallback(async () => {
    retryCountRef.current = 0;
    useEditorStore.getState().setKernelConnected(false);
    useEditorStore.getState().setKernelReady(false);
    useEditorStore.getState().setKernelStatus('connecting');
    useEditorStore.getState().setKernelProgress({ step: 0, total: MAX_RETRIES, label: 'Starting the kernel', fraction: 0 });
    try {
      await platform.startKernel();
    } catch (e) {
      // The Rust side explains exactly what went wrong (port busy, script
      // missing, python missing): show it instead of retrying a dead process.
      if (mountedRef.current) failKernel(normalizeKernelError(e));
      return;
    }
    connect();
  }, [connect, failKernel, platform]);

  const restartKernel = useCallback(() => {
    if (isWeb) {
      pyodideRef.current = null;
      void initPyodide();
      return;
    }
    wsRef.current?.close();
    wsRef.current = null;
    void platform.stopKernel().catch(() => { /* nothing running is fine */ }).then(() => {
      if (mountedRef.current) return startDesktopKernel();
    });
  }, [initPyodide, isWeb, platform, startDesktopKernel]);

  useEffect(() => {
    registerKernelRetry(restartKernel);
    return () => registerKernelRetry(null);
  }, [restartKernel]);

  // Start kernel. The old code slept 3000ms blind after startKernel() resolved;
  // we now rely on the retry loop instead — if the Python socket isn't open
  // yet, the initial connect fails fast and retry picks it up in RETRY_DELAY_MS.
  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0;

    if (isWeb) {
      void initPyodide();
    } else {
      void startDesktopKernel();
    }

    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      Object.values(connectTimersRef.current).forEach(clearTimeout);
      connectTimersRef.current = {};
      runtimeSubscriptionsRef.current.forEach((off) => off());
      runtimeSubscriptionsRef.current = [];
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (!isWeb) platform.stopKernel().catch(() => {});
    };
  }, [initPyodide, startDesktopKernel, platform, isWeb]);

  // Debounced parse on code change
  useEffect(() => {
    let prevCode = useEditorStore.getState().code;
    const unsub = useEditorStore.subscribe((state) => {
      if (state.code !== prevCode) {
        prevCode = state.code;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          // Skip parse requests while a simulation is running — the kernel
          // processes messages serially so a queued parse just delays the
          // result of the in-flight execute. The next keystroke after the
          // run completes will schedule another parse.
          if (useSimulationStore.getState().isRunning) return;

          const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);
          if (isWeb && pyodideRef.current) {
            pyodideRef.current.send({ type: 'parse', code: state.code, language });
          } else if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'parse', code: state.code, language }));
            // Editor diagnostics ride alongside parse (dev tools Phase 4).
            // Desktop + Python only — ruff lives in the managed kernel env, and
            // Q# has its own compiler diagnostics. Cleared here when it doesn't
            // apply so stale ruff squiggles don't linger after a language swap.
            if (language !== 'qsharp') {
              wsRef.current.send(JSON.stringify({ type: 'lint', code: state.code, language }));
            } else {
              useLintStore.getState().clear();
            }
          }
        }, useSettingsStore.getState().kernel.parseDebounceMs ?? DEFAULT_DEBOUNCE_MS);
      }
    });
    return unsub;
  }, [isWeb]);

  const execute = useCallback(() => {
    const { isRunning } = useSimulationStore.getState();
    if (isRunning) return;

    const { kernelReady } = useEditorStore.getState();
    if (!kernelReady) {
      const { kernelStatus, kernelError } = useEditorStore.getState();
      useSimulationStore.getState().addOutput(
        kernelStatus === 'failed'
          ? `The kernel is not running (${kernelError ?? 'start failed'}). Use Retry in the editor toolbar.`
          : 'Kernel is still loading. Please wait...',
        'info',
      );
      useBottomPanelStore.getState().focusTerminal();
      return;
    }

    const { code } = useEditorStore.getState();
    const { shots } = useSimulationStore.getState();
    const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);

    const runTime = new Date().toLocaleTimeString();
    const separator = `─── Run at ${runTime} ──────────────────────────────`;

    if (isWeb) {
      if (!pyodideRef.current) {
        useSimulationStore.getState().addOutput('Error: Browser Python engine not ready', 'stderr');
        useBottomPanelStore.getState().focusTerminal();
        return;
      }
      // clearResult() resets isRunning, so it must come first: setting the
      // flag before it silently re-enabled Run while a run was in flight.
      useSimulationStore.getState().clearResult();
      useSimulationStore.getState().setRunning(true);
      useSimulationStore.getState().addOutput(separator, 'separator');
      useBottomPanelStore.getState().focusTerminal();
      pyodideRef.current.send({ type: 'execute', code, shots, language });
    } else {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        useSimulationStore.getState().addOutput('Error: Kernel not connected', 'stderr');
        useBottomPanelStore.getState().focusTerminal();
        return;
      }
      // clearResult() resets isRunning, so it must come first: setting the
      // flag before it silently re-enabled Run while a run was in flight.
      useSimulationStore.getState().clearResult();
      useSimulationStore.getState().setRunning(true);
      useSimulationStore.getState().addOutput(separator, 'separator');
      useBottomPanelStore.getState().focusTerminal();
      ws.send(JSON.stringify({ type: 'execute', code, shots, language }));
    }
  }, [isWeb]);

  // Send a hardware request over the desktop WebSocket. No-ops on web since
  // there's no local kernel process to talk to there.
  const sendHardware = useCallback((payload: Record<string, unknown>) => {
    if (isWeb) return false;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, [isWeb]);

  const hardwareConnect = useCallback(
    (provider: string, credentials: Record<string, string>) => {
      useHardwareStore.getState().setConnecting(provider as never);
      useHardwareStore.getState().setConnectionError(provider as never, null);
      const ok = sendHardware({ type: 'hardware_connect', provider, credentials });
      if (!ok) {
        useHardwareStore.getState().setConnecting(null);
        useHardwareStore.getState().setConnectionError(
          provider as never,
          'Hardware connection requires the desktop app. Download from getnuclei.dev.',
        );
        return;
      }
      // Sent OK, but the provider might never answer (auth hangs). Arm a
      // watchdog that ends the "Connecting…" state with an honest error if no
      // hardware_connected arrives; cleared by that handler on success.
      clearTimeout(connectTimersRef.current[provider]);
      connectTimersRef.current[provider] = setTimeout(() => {
        const hw = useHardwareStore.getState();
        if (hw.connectingProvider === provider) {
          hw.setConnecting(null);
          hw.setConnectionError(
            provider as never,
            'Connection timed out — the provider didn’t respond. Check your token and try again.',
          );
        }
        delete connectTimersRef.current[provider];
      }, HARDWARE_CONNECT_TIMEOUT_MS);
    },
    [sendHardware],
  );

  const hardwareSubmit = useCallback(
    (provider: string, backend: string, code: string, shots: number, language?: KernelLanguage) =>
      sendHardware({
        type: 'hardware_submit',
        provider,
        backend,
        code,
        shots,
        // Callers that know the submission's true language (e.g. a staged
        // .qs file dropped on the launcher) pass it explicitly; otherwise
        // fall back to the editor's active framework as before.
        language: language ?? kernelLanguageFor(useEditorStore.getState().framework),
      }),
    [sendHardware],
  );

  const hardwareCancel = useCallback(
    (jobId: string) => {
      // Optimistically flip to failed so the UI responds immediately; the
      // kernel's ack will confirm. For unknown-to-kernel jobs, the response
      // still marks the local record as failed.
      useHardwareStore.getState().updateJob(jobId, { status: 'failed' });
      sendHardware({ type: 'hardware_cancel', job_id: jobId });
    },
    [sendHardware],
  );

  const hardwareDismiss = useCallback(
    (jobId: string) => {
      // Optimistically drop the job locally (mirrors hardwareCancel's
      // optimistic update, and keeps the web/no-kernel build working since
      // sendHardware no-ops there); the kernel removes the persisted record
      // so the job can't reappear next session.
      useHardwareStore.getState().clearJob(jobId);
      sendHardware({ type: 'hardware_dismiss', job_id: jobId });
    },
    [sendHardware],
  );

  // Detector graph "Sample a shot" (PRD 10 Phase D). Registered as a
  // module-level sender so the panel can request a decode without the socket
  // threaded through props; the response arrives via the qec_decode_sample
  // message handler → qecStore. web/no-kernel builds no-op (sendHardware).
  const qecDecodeSample = useCallback(
    (circuitText: string, decoder: string, seed: number) => {
      useQecStore.getState().setDecodePending(true);
      // If the message can't be sent (web build / closed socket) no response
      // will ever arrive to clear the flag — reset it so the button doesn't
      // spin forever.
      if (!sendHardware({ type: 'qec_decode_sample', circuit_text: circuitText, decoder, seed })) {
        useQecStore.getState().setDecodePending(false);
      }
    },
    [sendHardware],
  );
  const qecSnapshotReRequest = useCallback(
    (maxEdges: number) => {
      // No `code` → the kernel reuses the connection's last stim circuit at
      // the higher cap (the "render anyway" path from PRD 10 Phase A).
      sendHardware({ type: 'qec_snapshot', max_edges: maxEdges });
    },
    [sendHardware],
  );
  const qecExplain = useCallback(
    (circuitText: string, analysis: QecExplainAnalysis) => {
      const store = useQecExplainStore.getState();
      const requestId = `explain-${++explainSeqRef.current}`;
      store.begin(circuitText, requestId);
      const tooLarge = explainSizeError(circuitText);
      if (tooLarge) {
        store.setError(tooLarge, requestId);
        return;
      }
      // No socket → no reply will ever arrive; say so instead of spinning.
      if (!sendHardware({ type: 'qec_explain', circuit_text: circuitText, analysis, request_id: requestId })) {
        store.setError("The kernel isn't connected, so this circuit can't be explained. Start it and try again.");
      }
    },
    [sendHardware],
  );
  const qecEstimate = useCallback(
    (code: string, language: 'qsharp' | 'qasm3' | 'qiskit', options?: Record<string, unknown>) => {
      const store = useQecEstimateStore.getState();
      store.setPending(true);
      // No socket → no result will ever arrive; surface it instead of spinning
      // forever (setError also clears the pending flag).
      if (!sendHardware({ type: 'qec_estimate', code, language, options })) {
        store.setError("The kernel isn't connected. Start it and try again.");
      }
    },
    [sendHardware],
  );
  // Transpiler Explorer (dev tools Phase 1). Desktop-only (the web/pyodide
  // build can't run the Qiskit transpiler); sendHardware no-ops there, and the
  // panel is Qiskit-gated so it won't fire on web anyway.
  const transpile = useCallback(
    (code: string, target: { basisGates?: string[] | null; couplingMap?: Array<[number, number]> | null; optimizationLevel: 0 | 1 | 2 | 3 }) => {
      const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);
      const ok = sendHardware({
        type: 'transpile',
        code,
        language,
        basis_gates: target.basisGates ?? undefined,
        coupling_map: target.couplingMap ?? undefined,
        optimization_level: target.optimizationLevel,
      });
      if (!ok) {
        useTranspileStore.getState().setError("The kernel isn't connected. Start it and try again.");
      }
    },
    [sendHardware],
  );

  // Quantum Debugger (dev tools Phase 3). Desktop-only (the web/pyodide build
  // has no statevector debug path); sendHardware no-ops there.
  const debugTrace = useCallback(
    (code: string) => {
      const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);
      if (!sendHardware({ type: 'debug_trace', code, language })) {
        useDebugStore.getState().setError("The kernel isn't connected. Start it and try again.");
      }
    },
    [sendHardware],
  );

  // Editor lint + format (dev tools Phase 4). Desktop-only (ruff runs in the
  // managed kernel env); sendHardware no-ops on web.
  const lint = useCallback(
    (code: string) => {
      const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);
      sendHardware({ type: 'lint', code, language });
    },
    [sendHardware],
  );
  const format = useCallback(
    (code: string) => {
      const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);
      if (!sendHardware({ type: 'format', code, language })) {
        // No kernel → unblock the awaiting provider so it makes no edit.
        resolveFormat(null);
      }
    },
    [sendHardware],
  );

  useEffect(() => {
    setQecDecodeSender(qecDecodeSample);
    setQecSnapshotSender(qecSnapshotReRequest);
    setQecEstimateSender(qecEstimate);
    setQecExplainSender(qecExplain);
    setTranspileSender(transpile);
    setDebugTraceSender(debugTrace);
    setLintSender(lint);
    setFormatSender(format);
    return () => {
      setQecDecodeSender(null);
      setQecSnapshotSender(null);
      setQecEstimateSender(null);
      setQecExplainSender(null);
      setTranspileSender(null);
      setDebugTraceSender(null);
      setLintSender(null);
      setFormatSender(null);
    };
  }, [qecDecodeSample, qecSnapshotReRequest, qecEstimate, qecExplain, transpile, debugTrace, lint, format]);

  // Fetch the per-gate state trajectory when the user enters step-through mode,
  // and refresh it (debounced) if the code changes while stepping. The existing
  // circuitStore cursor then scrubs through the cached trace client-side. On
  // exit, drop the trace so the panels fall back to the final result.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let prevStepMode = useCircuitStore.getState().stepMode;

    const fetchTrace = () => {
      const code = useEditorStore.getState().code;
      if (!code.trim()) return;
      useDebugStore.getState().setPending(true);
      if (isWeb && pyodideRef.current) {
        const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);
        pyodideRef.current.send({ type: 'debug_trace', code, language });
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        const language = kernelLanguageFor(useEditorStore.getState().framework, useEditorStore.getState().filePath);
        wsRef.current.send(JSON.stringify({ type: 'debug_trace', code, language }));
      }
    };

    const unsubCircuit = useCircuitStore.subscribe((state) => {
      if (state.stepMode && !prevStepMode) fetchTrace();
      if (!state.stepMode && prevStepMode) useDebugStore.getState().clear();
      prevStepMode = state.stepMode;
    });

    let prevCode = useEditorStore.getState().code;
    const unsubEditor = useEditorStore.subscribe((state) => {
      if (state.code === prevCode) return;
      prevCode = state.code;
      if (!useCircuitStore.getState().stepMode) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(fetchTrace, useSettingsStore.getState().kernel.parseDebounceMs ?? DEFAULT_DEBOUNCE_MS);
    });

    return () => {
      if (debounce) clearTimeout(debounce);
      unsubCircuit();
      unsubEditor();
    };
  }, [isWeb]);

  // Polling backoff for active hardware jobs. A queued IBM job can sit in
  // the free-tier queue for an hour or more; fixed 5s polling would fire
  // ~720 status requests at the kernel for a single waiting job. The
  // schedule below follows the job's age since submit:
  //
  //   0-60s    → every 5s   (fast convergence on short queues)
  //   60s-5m   → every 15s
  //   5m-30m   → every 60s
  //   >30m     → every 5m
  //   >24h     → stop; mark 'stale'. User can re-poll manually via
  //              JobTracker's refresh action (which updates submittedAt
  //              in effect, resetting the schedule).
  //
  // Each interval gets ±10% jitter so jobs submitted in the same tick
  // don't all fire on the same second. Whenever status changes (e.g.
  // queued → running) the schedule resets to the fastest tier briefly
  // so we catch the completion quickly.
  const nextPollAtRef = useRef<Record<string, number>>({});
  const lastStatusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (isWeb) return;

    // Short tick: per-job scheduling is cheap and a 2s cadence keeps the
    // "tight tier" responsive without burning cycles when there are no
    // active jobs.
    const interval = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const jobs = useHardwareStore.getState().jobs;
      const results = useHardwareStore.getState().results;
      const now = Date.now();

      for (const j of jobs) {
        // If status changed since last tick, reset the schedule — the
        // next loop iteration will fire immediately, catching the
        // transition (queued→running) without waiting out the current
        // tier's delay.
        if (lastStatusRef.current[j.id] !== j.status) {
          lastStatusRef.current[j.id] = j.status;
          delete nextPollAtRef.current[j.id];
        }

        const pending = j.status === 'queued' || j.status === 'running';

        if (pending) {
          const submittedMs = Date.parse(j.submittedAt);
          const age = Number.isFinite(submittedMs)
            ? now - submittedMs
            : Number.POSITIVE_INFINITY;

          if (age > STALE_AFTER_MS) {
            // 24h with no terminal state — give up on automatic polling.
            // The job may still be alive on the provider; user can hit
            // the refresh button in JobTracker to resume.
            useHardwareStore.getState().updateJob(j.id, { status: 'stale' });
            delete nextPollAtRef.current[j.id];
            continue;
          }

          const nextAt = nextPollAtRef.current[j.id] ?? 0;
          if (now >= nextAt) {
            ws.send(JSON.stringify({ type: 'hardware_status', job_id: j.id }));
            nextPollAtRef.current[j.id] =
              now + computeNextPollDelayMs(Math.max(0, age / 1000));
          }
        }

        if (j.status === 'complete' && !results[j.id]) {
          // Job just flipped to complete (via hardware_job_update) but
          // we haven't fetched results yet — do it now so the dual-bar
          // chip appears without a manual refresh.
          ws.send(JSON.stringify({ type: 'hardware_results', job_id: j.id }));
        }

        if (!pending) {
          // Clean up scheduler state for terminal jobs so the ref
          // doesn't leak as jobs accumulate over a long session.
          delete nextPollAtRef.current[j.id];
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isWeb]);

  return { execute, hardwareConnect, hardwareSubmit, hardwareCancel, hardwareDismiss };
}
