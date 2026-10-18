import { useEffect, useRef, useState } from 'react';
import { useCircuitStore } from '../stores/circuitStore';
import { useEditorStore } from '../stores/editorStore';
import type { CircuitSnapshot } from '../types/quantum';

/** The editor debounces the parse by 300 ms; past this with no new snapshot the preview is visibly slow. */
export const PREVIEW_PENDING_DELAY_MS = 400;

/** The kernel's last answer when the wait began: any different answer (snapshot, error, pause) ends it. */
interface Answer {
  snapshot: CircuitSnapshot | null;
  error: string | null;
  previewPaused: boolean;
}

/**
 * True when the code has changed but no snapshot (or error, or pause) for it has arrived yet, so the circuit
 * on screen still describes the previous code. Only claimed while the kernel is ready (before that no update
 * is on its way) and a circuit is on screen.
 */
export function usePreviewPending(): boolean {
  const code = useEditorStore((s) => s.code);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const error = useCircuitStore((s) => s.error);
  const previewPaused = useCircuitStore((s) => s.previewPaused);
  const [waitingOn, setWaitingOn] = useState<Answer | null>(null);

  // A new edit starts the wait, but only once the preview has been quiet for longer than the usual debounce.
  const lastCode = useRef(code);
  useEffect(() => {
    const edited = lastCode.current !== code;
    lastCode.current = code;
    if (!edited || !kernelReady || code.trim() === '') return undefined;
    // Read the answer on screen when the timer fires, not when the edit happened.
    const timer = setTimeout(() => {
      const { snapshot: current, error: currentError, previewPaused: paused } = useCircuitStore.getState();
      setWaitingOn({ snapshot: current, error: currentError, previewPaused: paused });
    }, PREVIEW_PENDING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [code, kernelReady]);

  const unchanged = waitingOn !== null
    && waitingOn.snapshot === snapshot && waitingOn.error === error && waitingOn.previewPaused === previewPaused;
  return unchanged && kernelReady && snapshot !== null;
}
