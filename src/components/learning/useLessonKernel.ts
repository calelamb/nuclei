import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { KERNEL_WS_URL } from '../../config/kernel';
import { openAuthenticatedKernelSocket } from '../../services/kernelSocket';
import type { KernelResponse } from '../../types/quantum';

export type LessonKernelMessage = { type: string; [key: string]: unknown };

/** Shown when the desktop kernel socket is not open. Never used on the web build. */
export const DESKTOP_KERNEL_UNAVAILABLE = 'Kernel not connected. Make sure the Python kernel is running.';

interface WebKernel {
  init(): Promise<void>;
  send(msg: LessonKernelMessage): Promise<void>;
}

export interface LessonKernel {
  /** Resolves true once the message was handed to a kernel, false when no kernel is connected (desktop only). */
  send: (msg: LessonKernelMessage) => Promise<boolean>;
  /** Web only: Python is still downloading or starting; a Run is queued, not lost. */
  loading: boolean;
  /** Web only: the current boot stage, e.g. "Downloading Python". */
  stage: string | null;
}

interface Options {
  onMessage: (msg: KernelResponse) => void;
  /** The browser runtime failed to load (offline, blocked worker). */
  onInitError: (message: string) => void;
  /** The kernel became usable; re-send the live parse so circuit summaries appear. */
  onReady?: () => void;
}

/**
 * The kernel connection shared by lesson demos and exercises. On the web it
 * boots the shared Pyodide worker and queues sends behind that boot, so pressing
 * Run while Python is still loading runs as soon as it is ready. On desktop it
 * keeps a retrying authenticated WebSocket.
 */
export function useLessonKernel({ onMessage, onInitError, onReady }: Options): LessonKernel {
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';
  const [loading, setLoading] = useState(isWeb);
  const [stage, setStage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const webRef = useRef<Promise<WebKernel | null> | null>(null);
  const handlers = useRef({ onMessage, onInitError, onReady });
  useEffect(() => { handlers.current = { onMessage, onInitError, onReady }; });

  useEffect(() => {
    if (!isWeb) return undefined;
    let cancelled = false;
    const offs: Array<() => void> = [];
    const boot = (async (): Promise<WebKernel | null> => {
      const [{ PyodideKernel }, { pyodideRuntime }] = await Promise.all([
        import('../../platform/pyodideKernel'),
        import('../../platform/pyodide/pyodideClient'),
      ]);
      if (cancelled) return null;
      offs.push(pyodideRuntime.onProgress((p) => { if (!cancelled) setStage(p?.label ?? null); }));
      offs.push(pyodideRuntime.onState((s) => { if (!cancelled) setLoading(s !== 'ready'); }));
      setLoading(!pyodideRuntime.isReady());
      const kernel = new PyodideKernel((msg) => handlers.current.onMessage(msg as KernelResponse));
      try {
        await kernel.init();
      } catch (e) {
        if (!cancelled) {
          setLoading(false);
          handlers.current.onInitError(e instanceof Error ? e.message : String(e));
        }
        return null;
      }
      if (!cancelled) { setLoading(false); setStage(null); handlers.current.onReady?.(); }
      return kernel;
    })();
    webRef.current = boot;
    return () => { cancelled = true; offs.forEach((off) => off()); };
  }, [isWeb]);

  useEffect(() => {
    if (isWeb) return undefined;
    let ws: WebSocket | null = null;
    let cancelled = false;
    let retries = 0;
    function attach(socket: WebSocket) {
      socket.onopen = () => { wsRef.current = socket; retries = 0; handlers.current.onReady?.(); };
      socket.onmessage = (ev) => {
        try { handlers.current.onMessage(JSON.parse(ev.data)); } catch { /* malformed frame: ignore */ }
      };
      socket.onclose = () => {
        wsRef.current = null;
        if (retries < 3) { retries++; setTimeout(connect, 1000 * retries); }
      };
      socket.onerror = () => socket.close();
    }
    function connect() {
      void openAuthenticatedKernelSocket(KERNEL_WS_URL, platform.getKernelAuthToken?.bind(platform)).then((socket) => {
        if (cancelled) { socket.close(); return; }
        ws = socket;
        attach(socket);
      });
    }
    connect();
    return () => { cancelled = true; ws?.close(); };
  }, [isWeb, platform]);

  const send = useCallback(async (msg: LessonKernelMessage): Promise<boolean> => {
    if (isWeb) {
      const kernel = await webRef.current;
      if (!kernel) return false;
      await kernel.send(msg);
      return true;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, [isWeb]);

  return { send, loading, stage };
}
