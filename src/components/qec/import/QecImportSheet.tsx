import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog, IconButton } from '../../ui';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';

interface QecImportSheetProps {
  /** The source being imported, shown under the title. */
  source: string;
  /** Escape and the close button end the import wizard. */
  onDismiss?(): void;
  children: ReactNode;
}

const SHEET_WIDTH = 920;

/**
 * The import wizard on the shared Dialog: focus trap, focus return and the scrim
 * come from the primitive. A half-finished mapping is not worth losing to a stray
 * click, so the scrim does not dismiss; Escape does, handled here because the
 * Dialog's own dismissal covers both. The wizard keeps the workbench's token
 * scope (`qec-workbench`) because the Dialog portals out of it.
 */
export function QecImportSheet({ source, onDismiss, children }: QecImportSheetProps): ReactElement {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      dismissRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Dialog
      title="Import source"
      description={<span className="qec-mono">{source}</span>}
      width={SHEET_WIDTH}
      flush
      dismissible={false}
      onClose={() => dismissRef.current?.()}
      className="qec-import-dialog"
      trailing={(
        <IconButton aria-label="Close import wizard" onClick={() => dismissRef.current?.()}>
          <X aria-hidden="true" size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
        </IconButton>
      )}
    >
      <div className="qec-workbench qec-import-host">{children}</div>
    </Dialog>
  );
}
