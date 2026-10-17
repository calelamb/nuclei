import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}

/** Toggle exposed to assistive tech as role="switch" with aria-checked. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, className, onClick, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx('nuclei-switch', className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
    >
      <span className="nuclei-switch__thumb" aria-hidden="true" />
    </button>
  );
});
