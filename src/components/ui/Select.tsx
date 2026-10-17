import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { cx } from './cx';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
}

/** Native <select> (keeps OS pickers and a11y) with a token-styled chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', invalid = false, className, children, ...rest },
  ref,
) {
  return (
    <span className={cx('nuclei-select', `nuclei-select--${size}`, className)}>
      <select {...rest} ref={ref} aria-invalid={invalid || undefined}>{children}</select>
      <ChevronDown className="nuclei-select__chevron" aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
    </span>
  );
});
