import { useCallback, useEffect, useRef, useState } from 'react';

const COPIED_RESET_MS = 1500;

/** Clipboard copy with a short "copied" flag; the reset timer is cleared on unmount. */
export function useCopied(text: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const copy = useCallback((): void => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
      },
      () => setCopied(false),
    );
  }, [text]);
  return { copied, copy };
}
