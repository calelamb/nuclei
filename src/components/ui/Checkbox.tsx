import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { ICON_SIZE } from '../../styles/tokens';
import { cx } from './cx';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked' | 'size'> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Mixed state (some children selected); shown as a dash and exposed as aria-checked="mixed". */
  indeterminate?: boolean;
  /** Visible label. Without one, pass aria-label. */
  label?: ReactNode;
}

/** Native checkbox input (Space toggles, form-compatible) drawn with a token-styled box. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onCheckedChange, indeterminate = false, label, className, disabled, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cx('nuclei-checkbox', disabled && 'nuclei-checkbox--disabled', className)}>
      <input
        {...rest}
        ref={(node) => {
          inner.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : undefined}
        onChange={(event) => { if (!disabled) onCheckedChange(event.target.checked); }}
      />
      <span className="nuclei-checkbox__box" aria-hidden="true">
        {indeterminate
          ? <Minus size={ICON_SIZE.xs} className="nuclei-icon--bold" />
          : <Check size={ICON_SIZE.xs} className="nuclei-icon--bold" />}
      </span>
      {label !== undefined && <span className="nuclei-checkbox__label">{label}</span>}
    </label>
  );
});
