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

function readAnswer(): Answer {
  const { snapshot, error, previewPaused } = useCircuitStore.getState();
  return { snapshot, error, previewPaused };
}

function sameAnswer(a: Answer, b: Answer): boolean {
  return a.snapshot === b.snapshot && a.error === b.error && a.previewPaused === b.previewPaused;
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
    // The answer on screen at edit time: if it has already changed when the timer fires, the update arrived.
    const atEdit = readAnswer();
    const timer = setTimeout(() => {
      if (sameAnswer(atEdit, readAnswer())) setWaitingOn(atEdit);
    }, PREVIEW_PENDING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [code, kernelReady]);

  const unchanged = waitingOn !== null && sameAnswer(waitingOn, { snapshot, error, previewPaused });
  return unchanged && kernelReady && snapshot !== null;
}
