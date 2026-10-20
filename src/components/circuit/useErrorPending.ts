import { useEffect, useRef, useState } from 'react';
import { PREVIEW_PENDING_DELAY_MS } from '../../layout/usePreviewPending';
import { useCircuitStore } from '../../stores/circuitStore';
import { useEditorStore } from '../../stores/editorStore';

const hasError = () => useCircuitStore.getState().error !== null || (useEditorStore.getState().errors[0]?.line ?? null) !== null;

/**
 * The companion of usePreviewPending for a diagram that is stale because of an error: the code was edited,
 * but the kernel has not yet answered, so the "Out of date · line N" the person sees describes older code.
 * True from the moment the preview is visibly slow until the kernel answers again. "Answered" is a counter,
 * not a changed value, so an identical error coming back still ends the wait.
 */
export function useErrorPending(): boolean {
  const code = useEditorStore((s) => s.code);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  // The code the wait applies to: an edit makes it stale by itself, so nothing is reset in the effect body.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);

  const lastCode = useRef(code);
  useEffect(() => {
    const edited = lastCode.current !== code;
    lastCode.current = code;
    if (!edited || !kernelReady || code.trim() === '' || !hasError()) return undefined;
    const seqAtEdit = useCircuitStore.getState().answerSeq;
    const timer = setTimeout(() => {
      if (useCircuitStore.getState().answerSeq === seqAtEdit) setWaitingFor(code);
    }, PREVIEW_PENDING_DELAY_MS);
    // Subscribed outside render: an answer ends the wait without making this hook re-render on every store write.
    const unsubscribe = useCircuitStore.subscribe((state) => {
      if (state.answerSeq === seqAtEdit) return;
      clearTimeout(timer);
      setWaitingFor(null);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [code, kernelReady]);

  return waitingFor === code && kernelReady;
}
