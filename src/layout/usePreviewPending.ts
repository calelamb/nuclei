import { useEffect, useRef, useState } from 'react';
import { useCircuitStore } from '../stores/circuitStore';
import { useEditorStore } from '../stores/editorStore';

/** The editor debounces the parse by 300 ms; past this with no new snapshot the preview is visibly slow. */
export const PREVIEW_PENDING_DELAY_MS = 400;

/**
 * True when the code has changed but no snapshot (or error, or pause) for it has arrived yet, so the circuit
 * on screen still describes the previous code. Cleared by whatever the kernel answers next. Only claimed while
 * the kernel is ready (before that no update is on its way) and a circuit is on screen.
 */
export function usePreviewPending(): boolean {
  const code = useEditorStore((s) => s.code);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const error = useCircuitStore((s) => s.error);
  const previewPaused = useCircuitStore((s) => s.previewPaused);
  const [pending, setPending] = useState(false);

  // An answer for the current code (snapshot, error or pause) ends the wait.
  useEffect(() => {
    setPending(false);
  }, [snapshot, error, previewPaused]);

  // A new edit starts it, but only once the preview has been quiet for longer than the usual debounce.
  const lastCode = useRef(code);
  useEffect(() => {
    const edited = lastCode.current !== code;
    lastCode.current = code;
    if (!edited || !kernelReady || code.trim() === '') return undefined;
    const timer = setTimeout(() => setPending(true), PREVIEW_PENDING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [code, kernelReady]);

  // Only a circuit on screen can be out of date; with none, the next answer (or its absence) is not news.
  return pending && kernelReady && snapshot !== null;
}
