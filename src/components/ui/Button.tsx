import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy state: swaps the icon for a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
  /**
   * With `loading`: stay focusable (aria-disabled instead of `disabled`) and ignore presses, so keyboard focus
   * is not dropped to <body> when the press that started the work disables its own button. Use it whenever the
   * button can hold focus while it works (Run, Install, Save); leave it off for fire-and-forget buttons.
   */
  keepFocus?: boolean;
  /** Optional leading icon (a lucide element at ICON_SIZE.sm). */
  icon?: ReactNode;
}

/**
 * The one button. Visuals live in ui.css (hover, active, focus-visible,
 * disabled) so there are no inline style mutations or per-component hover state.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, keepFocus = false, icon, className, children, disabled, type = 'button', onClick, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled || (loading && !keepFocus)}
      aria-disabled={(loading && keepFocus) || undefined}
      aria-busy={loading || undefined}
      onClick={loading && keepFocus ? undefined : onClick}
      className={cx('nuclei-btn', `nuclei-btn--${variant}`, `nuclei-btn--${size}`, className)}
    >
      {loading
        ? <Loader2 className="nuclei-spin" aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        : icon}
      {children}
    </button>
  );
});
