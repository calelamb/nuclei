import { useEffect, useRef, useCallback } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import type { KernelResponse } from '../types/quantum';

const KERNEL_URL = 'ws://localhost:9742';
const DEBOUNCE_MS = 300;
const CONNECT_DELAY_MS = 3000;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 15;

export function useKernel() {
  const wsRef = useRef<WebSocket | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const platform = usePlatform();

  const setSnapshot = useCircuitStore.getState().setSnapshot;
  const setCircuitError = useCircuitStore.getState().setError;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log('[Nuclei] Connecting WebSocket to', KERNEL_URL, `(attempt ${retryCountRef.current + 1})`);
    const ws = new WebSocket(KERNEL_URL);

    ws.onopen = () => {
      console.log('[Nuclei] Kernel WebSocket connected');
      wsRef.current = ws;
      retryCountRef.current = 0;
      useEditorStore.getState().setKernelConnected(true);
      // Send initial parse for current code
      const code = useEditorStore.getState().code;
      if (code.trim()) {
        ws.send(JSON.stringify({ type: 'parse', code }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: KernelResponse = JSON.parse(event.data);
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
            const lineMatch = msg.message?.match(/line (\d+)/);
            if (lineMatch) {
              const line = parseInt(lineMatch[1], 10);
              const shortMsg = msg.message.split('\n').pop() ?? msg.message;
              useEditorStore.getState().setErrors([{ line, message: shortMsg }]);
            }
            break;
          }
        }
      } catch (e) {
        console.error('[Nuclei] Failed to parse kernel message:', e);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      useEditorStore.getState().setKernelConnected(false);
      if (mountedRef.current && retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        console.log(`[Nuclei] WebSocket closed, retrying in ${RETRY_DELAY_MS}ms...`);
        setTimeout(connect, RETRY_DELAY_MS);
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, so just close
      ws.close();
    };
  }, [setSnapshot, setCircuitError]);

  // Start kernel and connect
  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0;

    console.log('[Nuclei] Starting kernel process...');
    platform.startKernel()
      .then((msg) => {
        console.log('[Nuclei]', msg);
        // Connect after kernel has time to start
        setTimeout(connect, CONNECT_DELAY_MS);
      })
      .catch((err) => {
        console.error('[Nuclei] Failed to start kernel:', err);
        // Try connecting anyway — kernel might already be running
        setTimeout(connect, CONNECT_DELAY_MS);
      });

    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      platform.stopKernel().catch(() => {});
    };
  }, [connect, platform]);

  // Debounced parse on code change
  useEffect(() => {
    let prevCode = useEditorStore.getState().code;
    const unsub = useEditorStore.subscribe((state) => {
      if (state.code !== prevCode) {
        prevCode = state.code;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'parse', code: state.code }));
          }
        }, DEBOUNCE_MS);
      }
    });
    return unsub;
  }, []);

  const execute = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      useSimulationStore.getState().addOutput('Error: Kernel not connected');
      return;
    }

    const { code } = useEditorStore.getState();
    const { shots } = useSimulationStore.getState();

    useSimulationStore.getState().setRunning(true);
    useSimulationStore.getState().clearOutput();
    ws.send(JSON.stringify({ type: 'execute', code, shots }));
  }, []);

  return { execute };
}
