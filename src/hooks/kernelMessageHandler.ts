import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useSettingsStore } from '../stores/settingsStore';
import { kernelLanguageFor } from '../types/quantum';
import type { KernelResponse } from '../types/quantum';
import { useDiracStore } from '../stores/diracStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useQecStore } from '../stores/qecStore';
import { useQecEstimateStore } from '../stores/qecEstimateStore';
import { applyQecExplainResult, applyQecExplainError } from '../lib/qecExplainMessages';
import { useMissingDependencyStore } from '../stores/missingDependencyStore';
import { useTranspileStore } from '../stores/transpileStore';
import { useDebugStore } from '../stores/debugStore';
import { resolveFormat } from '../lib/lintSender';
import { useLintStore } from '../stores/lintStore';
import { narrateParse, narrateResult } from '../services/narration';
import { rewriteExecutionError } from '../services/errorRewrite';

/** Per-provider "connecting" watchdog timers, owned by the hook. */
export type ConnectTimers = Record<string, ReturnType<typeof setTimeout>>;

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

/** Route one kernel response into the stores. Pure of React: all state lives in stores. */
export function handleKernelMessage(msg: KernelResponse, connectTimers: ConnectTimers): void {
  switch (msg.type) {
    case 'snapshot':
      useCircuitStore.getState().setSnapshot(msg.data);
      useEditorStore.getState().clearErrors();
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
      useEditorStore.getState().clearErrors();
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
      useEditorStore.getState().clearErrors();
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
      // A preview that had to be killed is the one parse event worth saying out loud.
      if (isParseError && msg.code === 'timeout') {
        useSimulationStore.getState().addOutput(shortMessage, 'info');
      }
      if (!isParseError) {
        useSimulationStore.getState().addOutput(`Error: ${detail}`, 'stderr');
        useSimulationStore.getState().setRunning(false);
        useSimulationStore.getState().setRunFailed(true);
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
        useCircuitStore.getState().setSnapshot(null);
        useCircuitStore.getState().setError(msg.message);
      }

      if (msg.phase === 'execute' || msg.phase === 'python') {
        useSimulationStore.getState().clearResult();
        if (msg.phase === 'execute') {
          useCircuitStore.getState().setError(msg.message);
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
      clearTimeout(connectTimers[msg.provider]);
      delete connectTimers[msg.provider];
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
}
