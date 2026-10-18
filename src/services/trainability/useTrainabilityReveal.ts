/**
 * Jump the editor to a line the verdict rail asked for. The Lab takeover
 * hides (does not unmount) the editor, so the request is stored and consumed
 * here once the editor is visible again.
 */

import { useEffect, useRef } from 'react';
import { useTrainabilityStore } from '../../stores/trainabilityStore';

export interface RevealableEditor {
  revealLineInCenter(line: number): void;
  setPosition(position: { lineNumber: number; column: number }): void;
  focus(): void;
}

export function useTrainabilityReveal(editor: RevealableEditor | null): void {
  const request = useTrainabilityStore((s) => s.revealRequest);
  const handled = useRef<number>(0);
  useEffect(() => {
    if (!editor || !request || request.nonce === handled.current) return;
    handled.current = request.nonce;
    editor.revealLineInCenter(request.line);
    editor.setPosition({ lineNumber: request.line, column: 1 });
    editor.focus();
  }, [editor, request]);
}
