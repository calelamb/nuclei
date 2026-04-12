import { useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { KernelResponse } from '../types/quantum';
import { KERNEL_WS_URL } from '../config/kernel';

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
const DEFAULT_DEBOUNCE_MS = 300;
const CONNECT_DELAY_MS = 3000;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 15;

export function useKernel() {
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pyodideRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const setSnapshot = useCircuitStore.getState().setSnapshot;
  const setCircuitError = useCircuitStore.getState().setError;

  const handleMessage = useCallback((msg: KernelResponse) => {
    switch (msg.type) {
      case 'snapshot':
        setSnapshot(msg.data);
        useEditorStore.getState().setFramework(msg.data.framework);
        break;
      case 'result':
        useSimulationStore.getState().setResult(msg.data);
        break;
      case 'output':
        useSimulationStore.getState().addOutput(msg.text);
        break;
      case 'error': {
        useSimulationStore.getState().addOutput(`Error: ${msg.message}`);
        setCircuitError(msg.message);
        useSimulationStore.getState().setRunning(false);
        const frames = msg.message?.match(/File "<(?:string|exec)>", line (\d+)/g) || [];
        const lastFrame = frames[frames.length - 1];
        const lineMatch = lastFrame?.match(/line (\d+)/);
        if (lineMatch) {
          const line = parseInt(lineMatch[1], 10);
          const shortMsg = msg.message.split('\n').pop() ?? msg.message;
          useEditorStore.getState().setErrors([{ line, message: shortMsg }]);
        }
        break;
      }
    }
  }, [setSnapshot, setCircuitError]);

  // WebSocket connection for desktop
  const connect = useCallback(() => {
    if (!mountedRef.current || isWeb) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(KERNEL_URL);

    ws.onopen = () => {
      wsRef.current = ws;
      retryCountRef.current = 0;
      useEditorStore.getState().setKernelConnected(true);
      useEditorStore.getState().setKernelReady(true);
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
      if (mountedRef.current && retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        setTimeout(connect, RETRY_DELAY_MS);
      }
    };

    ws.onerror = () => { ws.close(); };
  }, [handleMessage, isWeb]);

  // Initialize Pyodide kernel for web
  const initPyodide = useCallback(async () => {
    if (!isWeb) return;
    useEditorStore.getState().setKernelConnected(false);
    useEditorStore.getState().setKernelReady(false);

    try {
      const { PyodideKernel } = await import('../platform/pyodideKernel');
      const kernel = new PyodideKernel((msg) => handleMessage(msg as KernelResponse));
      await kernel.init();
      pyodideRef.current = kernel;
      useEditorStore.getState().setKernelConnected(true);
      useEditorStore.getState().setKernelReady(true);

      // Swap Qiskit default to Cirq for web mode (Pyodide only has Cirq)
      const currentCode = useEditorStore.getState().code;
      if (currentCode.includes('from qiskit import QuantumCircuit')) {
        useEditorStore.getState().setCode(CIRQ_WEB_DEFAULT);
        useEditorStore.getState().setFramework('cirq');
      }

      // Initial parse
      const code = useEditorStore.getState().code;
      if (code.trim()) {
        kernel.send({ type: 'parse', code });
      }
    } catch (e) {
      useSimulationStore.getState().addOutput(`Error: Failed to load browser Python engine: ${e}`);
    }
  }, [handleMessage, isWeb]);

  // Start kernel
  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0;

    if (isWeb) {
      initPyodide();
    } else {
      platform.startKernel()
        .then(() => {
          setTimeout(connect, CONNECT_DELAY_MS);
        })
        .catch(() => {
          setTimeout(connect, CONNECT_DELAY_MS);
        });
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
      useSimulationStore.getState().clearOutput();
      pyodideRef.current.send({ type: 'execute', code, shots });
    } else {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        useSimulationStore.getState().addOutput('Error: Kernel not connected');
        return;
      }
      useSimulationStore.getState().setRunning(true);
      useSimulationStore.getState().clearOutput();
      ws.send(JSON.stringify({ type: 'execute', code, shots }));
    }
  }, [isWeb]);

  return { execute };
}
