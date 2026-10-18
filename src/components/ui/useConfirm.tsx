import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog';

interface Pending { options: ConfirmOptions; resolve: (ok: boolean) => void }

/**
 * `const { confirm, confirmDialog } = useConfirm();` render `{confirmDialog}` once, then
 * `if (!(await confirm({ ... }))) return;` where a native confirm used to block.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; confirmDialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false);
    const next = { options, resolve };
    pendingRef.current = next;
    setPending(next);
  }), []);

  // An unmounted host must not leave its caller awaiting forever.
  useEffect(() => () => { pendingRef.current?.resolve(false); }, []);

  const confirmDialog = pending
    ? <ConfirmDialog {...pending.options} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
    : null;
  return { confirm, confirmDialog };
}
