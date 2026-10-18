import { useEffect, useRef, useState } from 'react';
import { PREVIEW_PENDING_DELAY_MS } from '../../layout/usePreviewPending';
import { useCircuitStore } from '../../stores/circuitStore';
import { useEditorStore } from '../../stores/editorStore';

interface ErrorAnswer {
  error: string | null;
  errorLine: number | null;
}

function readAnswer(): ErrorAnswer {
  return {
    error: useCircuitStore.getState().error,
    errorLine: useEditorStore.getState().errors[0]?.line ?? null,
  };
}

const sameAnswer = (a: ErrorAnswer, b: ErrorAnswer) => a.error === b.error && a.errorLine === b.errorLine;
const hasError = (a: ErrorAnswer) => a.error !== null || a.errorLine !== null;

/**
 * The companion of usePreviewPending for a diagram that is stale because of an error: the code was edited,
 * but the kernel has not yet answered, so the "Out of date · line N" the person sees describes older code.
 * True from the moment the preview is visibly slow until any new answer (fix, new error, pause) arrives.
 */
export function useErrorPending(): boolean {
  const code = useEditorStore((s) => s.code);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const error = useCircuitStore((s) => s.error);
  const errorLine = useEditorStore((s) => s.errors[0]?.line ?? null);
  const [waitingOn, setWaitingOn] = useState<ErrorAnswer | null>(null);

  const lastCode = useRef(code);
  useEffect(() => {
    const edited = lastCode.current !== code;
    lastCode.current = code;
    const atEdit = readAnswer();
    if (!edited || !kernelReady || code.trim() === '' || !hasError(atEdit)) return undefined;
    const timer = setTimeout(() => {
      if (sameAnswer(atEdit, readAnswer())) setWaitingOn(atEdit);
    }, PREVIEW_PENDING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [code, kernelReady]);

  return waitingOn !== null && kernelReady && sameAnswer(waitingOn, { error, errorLine });
}
