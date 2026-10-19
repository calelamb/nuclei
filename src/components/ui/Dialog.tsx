import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { ICON_SIZE } from '../../styles/tokens';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { cx } from './cx';
import { closeActiveTooltip } from './tooltipSingleton';

export interface DialogProps {
  /** Visible title; it names the dialog (aria-labelledby). */
  title: ReactNode;
  /** Element before the title (e.g. a Back button). */
  leading?: ReactNode;
  /** Element after the title, right-aligned (e.g. a close IconButton). */
  trailing?: ReactNode;
  /** Optional one-line explanation under the title (aria-describedby). */
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  /** Right-aligned action row; put the primary action last. */
  footer?: ReactNode;
  /** Panel width in px (capped to 92vw). Default 440. */
  width?: number;
  /** `top` pins the panel near the top (palette-style); default `center`. */
  align?: 'center' | 'top';
  /** Escape and scrim click call onClose. Default true; turn off for blocking flows. */
  dismissible?: boolean;
  /** CSS selector inside the dialog to focus on open (default: first focusable). */
  initialFocus?: string;
  className?: string;
  /** Edge-to-edge body (diff panes, long forms): the panel drops its padding; header and footer keep theirs. */
  flush?: boolean;
  /** Suppress the default Close button (a dismissible dialog gets one unless `trailing` is set). */
  hideClose?: boolean;
  /** Stacking order; the default sits above panels and below tooltips. */
  zIndex?: number;
  /** `alertdialog` for confirmations that interrupt with a decision. Default `dialog`. */
  role?: 'dialog' | 'alertdialog';
}

/**
 * The one modal. Real keyboard citizen: role=dialog + aria-modal named by its
 * visible title, focus moves in on open, Tab wraps, Escape closes, and focus
 * returns to whatever opened it. The scrim uses the --color-scrim token.
 * Portaled to <body> so an inert app shell can never swallow it.
 */
export function Dialog({
  title, description, leading, trailing, onClose, children, footer, width = 440, align = 'center',
  dismissible = true, initialFocus, className, flush = false, hideClose = false, zIndex = 4600, role = 'dialog',
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // A tooltip left open by the trigger that opened this dialog would float above the scrim.
  useEffect(() => { closeActiveTooltip(); }, []);

  useFocusTrap(panelRef, { restoreFocus: true, autoFocus: true, autoFocusSkip: '.nuclei-dialog__header' });

  useEffect(() => {
    if (!initialFocus) return;
    // focusVisible keeps the ring on a target focused from code after a keyboard-opened dialog (browsers that support it).
    panelRef.current?.querySelector<HTMLElement>(initialFocus)?.focus({ focusVisible: true } as FocusOptions);
  }, [initialFocus]);

  useEffect(() => {
    if (!dismissible) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissible]);

  return createPortal(
    <div
      data-testid="dialog-scrim"
      className={cx('nuclei-dialog-scrim', align === 'top' && 'nuclei-dialog-scrim--top')}
      style={{ zIndex }}
      onMouseDown={(e) => {
        // Only a press that starts on the scrim itself dismisses; a drag that ends there does not.
        if (dismissible && e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx('nuclei-dialog', flush && 'nuclei-dialog--flush', className)}
        style={{ width: Math.min(width, Math.floor(window.innerWidth * 0.92)) }}
      >
        <div className="nuclei-dialog__header">
          {leading}
          <h2 id={titleId} className="nuclei-dialog__title">{title}</h2>
          {trailing ?? (dismissible && !hideClose ? (
            <IconButton size="sm" aria-label="Close" className="nuclei-dialog__close" onClick={() => onCloseRef.current()}>
              <X size={ICON_SIZE.sm} aria-hidden="true" />
            </IconButton>
          ) : null)}
        </div>
        {description && <p id={descId} className="nuclei-dialog__desc">{description}</p>}
        {children && <div className="nuclei-dialog__body">{children}</div>}
        {footer && <div className="nuclei-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
