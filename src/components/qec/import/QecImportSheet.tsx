import { useEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

interface QecImportSheetProps {
  /** Escape from inside the sheet (not from an open select) closes it. */
  onDismiss?(): void;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Tab / Shift+Tab wrap inside the sheet instead of escaping to the workbench behind the scrim. */
function trapTab(event: KeyboardEvent<HTMLDivElement>, root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Modal sheet for the import wizard: a scrim over the workbench and a centred
 * panel, so the wizard gets real room instead of stretching the jobs tray.
 * Local to the QEC workbench until the shared Dialog primitive lands; the
 * scrim deliberately does not dismiss (a half-finished mapping is not worth
 * losing to a stray click) while Escape does.
 */
export function QecImportSheet({ onDismiss, children }: QecImportSheetProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.stopPropagation();
      onDismiss?.();
    } else if (event.key === 'Tab' && panelRef.current) {
      trapTab(event, panelRef.current);
    }
  };
  return (
    <div className="qec-import-sheet" onKeyDown={onKeyDown}>
      <div className="qec-import-sheet__scrim" aria-hidden="true" />
      <div ref={panelRef} className="qec-import-sheet__panel" role="dialog" aria-modal="true" aria-label="Import QEC data">
        {children}
      </div>
    </div>
  );
}
