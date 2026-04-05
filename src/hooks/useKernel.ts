import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import type { KernelResponse } from '../types/quantum';

const KERNEL_URL = 'ws://localhost:9742';
const DEBOUNCE_MS = 300;
const CONNECT_DELAY_MS = 2000;
const RETRY_DELAY_MS = 1500;

export function useKernel() {
  const wsRef = useRef<WebSocket | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const setSnapshot = useCircuitStore.getState().setSnapshot;
  const setCircuitError = useCircuitStore.getState().setError;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(KERNEL_URL);

    ws.onopen = () => {
      console.log('Kernel WebSocket connected');
      wsRef.current = ws;
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
            // Detect framework from snapshot
            useEditorStore.getState().setFramework(msg.data.framework);
            break;
          case 'result':
            useSimulationStore.getState().setResult(msg.data);
            break;
          case 'output':
            useSimulationStore.getState().addOutput(msg.text);
            break;
          case 'error':
            useSimulationStore.getState().addOutput(`Error: ${msg.message}`);
            setCircuitError(msg.message);
            useSimulationStore.getState().setRunning(false);
            break;
        }
      } catch (e) {
        console.error('Failed to parse kernel message:', e);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (mountedRef.current) {
        setTimeout(connect, RETRY_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [setSnapshot, setCircuitError]);

  // Start kernel and connect
  useEffect(() => {
    mountedRef.current = true;

    invoke('start_kernel')
      .then((msg) => console.log(msg))
      .catch((err) => console.error('Failed to start kernel:', err));

    // Wait for kernel to start, then connect WebSocket
    const timer = setTimeout(connect, CONNECT_DELAY_MS);

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (wsRef.current) wsRef.current.close();
      invoke('stop_kernel').catch(() => {});
    };
  }, [connect]);

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
