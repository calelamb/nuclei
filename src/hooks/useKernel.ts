import { useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { KernelResponse } from '../types/quantum';
import { KERNEL_WS_URL } from '../config/kernel';
import type { PyodideKernel } from '../platform/pyodideKernel';
import { useDiracStore } from '../stores/diracStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { narrateParse, narrateResult } from '../services/narration';
import { rewritePythonError } from '../services/errorRewrite';
import { computeNextPollDelayMs, STALE_AFTER_MS } from '../lib/pollSchedule';

const KERNEL_URL = KERNEL_WS_URL;

const CIRQ_WEB_DEFAULT = `import cirq

# Create a Bell State
q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.CNOT(q0, q1),
    cirq.measure(q0, q1, key='result')
])
`;
const PYTHON_ONLY_WEB_DEFAULT = `# The browser IDE is in limited mode — Cirq couldn't load.
# You can still run plain Python. For full quantum support,
# download the desktop app from getnuclei.dev.

print("Hello from Pyodide!")
`;
const DEFAULT_DEBOUNCE_MS = 300;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 15;

function getErrorContext(msg: Extract<KernelResponse, { type: 'error' }>) {
  const detail = msg.traceback ?? msg.message;
  const frames = detail.match(/File "<(?:string|exec)>", line (\d+)/g) || [];
  const lastFrame = frames[frames.length - 1];
  const lineMatch = lastFrame?.match(/line (\d+)/);
  const line = lineMatch ? parseInt(lineMatch[1], 10) : null;

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
        if (msg.data) {
          useEditorStore.getState().setFramework(msg.data.framework);
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
      case 'output':
        useSimulationStore.getState().addOutput(msg.text, 'stdout');
        useBottomPanelStore.getState().focusTerminal();
        break;
      case 'stderr':
        useSimulationStore.getState().addOutput(msg.text, 'stderr');
        useBottomPanelStore.getState().focusTerminal();
        break;
      case 'error': {
        const { detail, line, shortMessage } = getErrorContext(msg);

        useSimulationStore.getState().addOutput(`Error: ${detail}`, 'stderr');
        useSimulationStore.getState().setRunning(false);
        useBottomPanelStore.getState().focusTerminal();

        if (useSettingsStore.getState().dirac.autoExplainErrors) {
          const codeForRewrite = useEditorStore.getState().code;
          const framework = useEditorStore.getState().framework;
          rewritePythonError({ code: codeForRewrite, framework, traceback: detail })
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
  const connect = useCallback(() => {
    if (!mountedRef.current || isWeb) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    useEditorStore.getState().setKernelStatus('connecting');

    const ws = new WebSocket(KERNEL_URL);

    ws.onopen = () => {
      wsRef.current = ws;
      retryCountRef.current = 0;
      useEditorStore.getState().setKernelConnected(true);
      useEditorStore.getState().setKernelReady(true);
      useEditorStore.getState().setKernelStatus('ready');
      const code = useEditorStore.getState().code;
      if (code.trim()) {
        ws.send(JSON.stringify({ type: 'parse', code }));
      }

      // One-time migration: earlier builds wrote provider credentials to
      // localStorage as plaintext. On first connect after the keyring move,
      // hand any stashed tokens to the kernel and wipe localStorage so the
      // secrets never sit in the browser again. Safe to re-run — if there
      // are no legacy keys, the whole block no-ops.
      try {
        const LEGACY_PREFIX = 'nuclei-hardware-';
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(LEGACY_PREFIX)) continue;
          const provider = key.slice(LEGACY_PREFIX.length);
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const creds = JSON.parse(raw);
            if (creds && typeof creds === 'object') {
              ws.send(JSON.stringify({
                type: 'hardware_set_credentials',
                provider,
                credentials: creds,
              }));
            }
          } catch { /* malformed legacy entry — drop it */ }
          localStorage.removeItem(key);
        }
      } catch { /* localStorage may be unavailable in some embedded webviews */ }

      // Ask the kernel which providers it already has connections to from
      // its keyring-backed auto-reconnect, so the UI shows them as connected
      // without the user having to re-enter tokens.
      ws.send(JSON.stringify({ type: 'hardware_connected_providers' }));
      // Rehydrate JobTracker from the kernel's persistent registry so the
      // user sees their past jobs (marked 'stale' when not recoverable)
      // instead of an empty list on reload.
      ws.send(JSON.stringify({ type: 'hardware_list_jobs' }));
    };

    ws.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(event.data));
      } catch (e) {
        if (import.meta.env.DEV) console.error('[Nuclei] Failed to parse kernel message:', e);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      useEditorStore.getState().setKernelConnected(false);
      if (!mountedRef.current) return;

      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        setTimeout(connect, RETRY_DELAY_MS);
      } else {
        useEditorStore.getState().setKernelStatus(
          'failed',
          'Kernel is not responding. Check that Python is installed and try reconnecting.',
        );
      }
    };

    ws.onerror = () => { ws.close(); };
  }, [handleMessage, isWeb]);


  // Initialize Pyodide kernel for web
  const initPyodide = useCallback(async () => {
    if (!isWeb) return;
    useEditorStore.getState().setKernelConnected(false);
    useEditorStore.getState().setKernelReady(false);
    useEditorStore.getState().setKernelStatus('connecting');

    try {
      const { PyodideKernel, isCirqAvailable } = await import('../platform/pyodideKernel');
      const kernel = new PyodideKernel((msg) => handleMessage(msg as KernelResponse));
      await kernel.init();
      pyodideRef.current = kernel;
      useEditorStore.getState().setKernelConnected(true);
      useEditorStore.getState().setKernelReady(true);
      useEditorStore.getState().setKernelStatus('ready');

      // Only rewrite the user's starting code if they're still on the Qiskit
      // default. Pick a replacement that matches what actually works in the
      // browser — Cirq if it loaded, plain-Python otherwise.
      const currentCode = useEditorStore.getState().code;
      if (currentCode.includes('from qiskit import QuantumCircuit')) {
        if (isCirqAvailable()) {
          useEditorStore.getState().setCode(CIRQ_WEB_DEFAULT);
          useEditorStore.getState().setFramework('cirq');
        } else {
          useEditorStore.getState().setCode(PYTHON_ONLY_WEB_DEFAULT);
        }
      }

      // Initial parse
      const code = useEditorStore.getState().code;
      if (code.trim()) {
        kernel.send({ type: 'parse', code });
      }
    } catch (e) {
      useEditorStore.getState().setKernelStatus('failed', `Failed to load browser Python engine: ${e}`);
      useSimulationStore.getState().addOutput(`Error: Failed to load browser Python engine: ${e}`, 'stderr');
    }
  }, [handleMessage, isWeb]);

  // Start kernel. The old code slept 3000ms blind after startKernel() resolved;
  // we now rely on the retry loop instead — if the Python socket isn't open
  // yet, the initial connect fails fast and retry picks it up in RETRY_DELAY_MS.
  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0;

    if (isWeb) {
      initPyodide();
    } else {
      platform.startKernel()
        .then(() => connect())
        .catch(() => connect());
    }

    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (!isWeb) platform.stopKernel().catch(() => {});
    };
  }, [connect, initPyodide, platform, isWeb]);

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

          if (isWeb && pyodideRef.current) {
            pyodideRef.current.send({ type: 'parse', code: state.code });
          } else if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'parse', code: state.code }));
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
      useSimulationStore.getState().addOutput('Kernel is still loading. Please wait...', 'info');
      useBottomPanelStore.getState().focusTerminal();
      return;
    }

    const { code } = useEditorStore.getState();
    const { shots } = useSimulationStore.getState();

    const runTime = new Date().toLocaleTimeString();
    const separator = `─── Run at ${runTime} ──────────────────────────────`;

    if (isWeb) {
      if (!pyodideRef.current) {
        useSimulationStore.getState().addOutput('Error: Browser Python engine not ready', 'stderr');
        useBottomPanelStore.getState().focusTerminal();
        return;
      }
      useSimulationStore.getState().setRunning(true);
      useSimulationStore.getState().clearResult();
      useSimulationStore.getState().addOutput(separator, 'separator');
      useBottomPanelStore.getState().focusTerminal();
      pyodideRef.current.send({ type: 'execute', code, shots });
    } else {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        useSimulationStore.getState().addOutput('Error: Kernel not connected', 'stderr');
        useBottomPanelStore.getState().focusTerminal();
        return;
      }
      useSimulationStore.getState().setRunning(true);
      useSimulationStore.getState().clearResult();
      useSimulationStore.getState().addOutput(separator, 'separator');
      useBottomPanelStore.getState().focusTerminal();
      ws.send(JSON.stringify({ type: 'execute', code, shots }));
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
      }
    },
    [sendHardware],
  );

  const hardwareSubmit = useCallback(
    (provider: string, backend: string, code: string, shots: number) =>
      sendHardware({ type: 'hardware_submit', provider, backend, code, shots }),
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

  return { execute, hardwareConnect, hardwareSubmit, hardwareCancel };
}
