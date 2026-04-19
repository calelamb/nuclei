import { useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { KernelResponse } from '../types/quantum';
import { KERNEL_WS_URL } from '../config/kernel';
import type { PyodideKernel } from '../platform/pyodideKernel';
import { useDiracStore } from '../stores/diracStore';
import { narrateParse, narrateResult } from '../services/narration';
import { rewritePythonError } from '../services/errorRewrite';

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
        useSimulationStore.getState().addOutput(msg.text);
        break;
      case 'error': {
        const { detail, line, shortMessage } = getErrorContext(msg);

        useSimulationStore.getState().addOutput(`Error: ${detail}`);
        useSimulationStore.getState().setRunning(false);

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
      useSimulationStore.getState().addOutput(`Error: Failed to load browser Python engine: ${e}`);
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
      useSimulationStore.getState().addOutput('Kernel is still loading. Please wait...');
      return;
    }

    const { code } = useEditorStore.getState();
    const { shots } = useSimulationStore.getState();

    if (isWeb) {
      if (!pyodideRef.current) {
        useSimulationStore.getState().addOutput('Error: Browser Python engine not ready');
        return;
      }
      useSimulationStore.getState().setRunning(true);
      useSimulationStore.getState().clearResult();
      useSimulationStore.getState().clearOutput();
      pyodideRef.current.send({ type: 'execute', code, shots });
    } else {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        useSimulationStore.getState().addOutput('Error: Kernel not connected');
        return;
      }
      useSimulationStore.getState().setRunning(true);
      useSimulationStore.getState().clearResult();
      useSimulationStore.getState().clearOutput();
      ws.send(JSON.stringify({ type: 'execute', code, shots }));
    }
  }, [isWeb]);

  return { execute };
}
