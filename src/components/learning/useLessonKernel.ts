import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { KERNEL_WS_URL } from '../../config/kernel';
import { openAuthenticatedKernelSocket } from '../../services/kernelSocket';
import type { KernelResponse } from '../../types/quantum';
import type { BootProgress } from '../../platform/pyodide/workerProtocol';

export type LessonKernelMessage = { type: string; [key: string]: unknown };

/** Shown when the desktop kernel socket is not open. Never used on the web build. */
export const DESKTOP_KERNEL_UNAVAILABLE = 'Kernel not connected. Make sure the Python kernel is running.';

/** Web fallback when the browser Python engine could not start. */
export const WEB_KERNEL_UNAVAILABLE = "Couldn't start the browser Python engine. Check your connection or content blocker, then retry.";

interface WebKernel {
  init(): Promise<void>;
  send(msg: LessonKernelMessage): Promise<void>;
}

export interface SendOptions {
  /** Checked once the boot wait is over: a queued Run the student cancelled is dropped, not sent. */
  isCancelled?: () => boolean;
}

export interface LessonKernel {
  /** Resolves true once the message was handed to a kernel, false when no kernel is connected (desktop only). */
  send: (msg: LessonKernelMessage, options?: SendOptions) => Promise<boolean>;
  /** Web only: Python is still downloading or starting; a Run is queued, not lost. */
  loading: boolean;
  /** Web only: the current boot stage, e.g. "Downloading Python". */
  stage: string | null;
  /** Web only: the current boot stage with its step count, for the Run button. */
  progress: BootProgress | null;
  /** What to tell the user when send() resolved false: platform-appropriate, never the desktop sentence on the web. */
  unavailableMessage: () => string;
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
  const [progress, setProgress] = useState<BootProgress | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const webRef = useRef<Promise<WebKernel | null> | null>(null);
  const handlers = useRef({ onMessage, onInitError, onReady });
  useEffect(() => { handlers.current = { onMessage, onInitError, onReady }; });

  const cancelledRef = useRef(false);
  const offsRef = useRef<Array<() => void>>([]);
  const lastErrorRef = useRef<string>(WEB_KERNEL_UNAVAILABLE);

  const startBoot = useCallback((): Promise<WebKernel | null> => {
    const fail = (e: unknown): null => {
      const message = e instanceof Error ? e.message : String(e);
      lastErrorRef.current = message;
      if (!cancelledRef.current) {
        setLoading(false);
        handlers.current.onInitError(message);
      }
      return null;
    };
    const boot = (async (): Promise<WebKernel | null> => {
      let modules;
      try {
        modules = await Promise.all([
          import('../../platform/pyodideKernel'),
          import('../../platform/pyodide/pyodideClient'),
        ]);
      } catch (e) {
        return fail(e);
      }
      const [{ PyodideKernel }, { pyodideRuntime }] = modules;
      if (cancelledRef.current) return null;
      offsRef.current.forEach((off) => off());
      offsRef.current = [
        pyodideRuntime.onProgress((p) => { if (!cancelledRef.current) setProgress(p); }),
        pyodideRuntime.onState((s) => { if (!cancelledRef.current) setLoading(s !== 'ready'); }),
      ];
      setLoading(!pyodideRuntime.isReady());
      const kernel = new PyodideKernel((msg) => handlers.current.onMessage(msg as KernelResponse));
      try {
        await kernel.init();
      } catch (e) {
        return fail(e);
      }
      if (!cancelledRef.current) { setLoading(false); setProgress(null); handlers.current.onReady?.(); }
      return kernel;
    })();
    webRef.current = boot;
    return boot;
  }, []);

  useEffect(() => {
    if (!isWeb) return undefined;
    cancelledRef.current = false;
    void startBoot();
    return () => {
      cancelledRef.current = true;
      offsRef.current.forEach((off) => off());
      offsRef.current = [];
    };
  }, [isWeb, startBoot]);

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

  const send = useCallback(async (msg: LessonKernelMessage, options?: SendOptions): Promise<boolean> => {
    if (isWeb) {
      let kernel = await webRef.current;
      if (!kernel) {
        // The earlier boot failed (offline, blocked worker): Run is the retry.
        setLoading(true);
        kernel = await startBoot();
      }
      if (!kernel) return false;
      if (options?.isCancelled?.()) return true;
      await kernel.send(msg);
      return true;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, [isWeb, startBoot]);

  const unavailableMessage = useCallback(
    () => (isWeb ? lastErrorRef.current : DESKTOP_KERNEL_UNAVAILABLE),
    [isWeb],
  );
  return { send, loading, stage: progress?.label ?? null, progress, unavailableMessage };
}
