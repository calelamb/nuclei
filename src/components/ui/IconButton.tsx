import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: an icon-only control has no other accessible name. Also used as the tooltip. */
  'aria-label': string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', className, title, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      title={title ?? rest['aria-label']}
      className={cx('nuclei-icon-btn', `nuclei-icon-btn--${variant}`, `nuclei-icon-btn--${size}`, className)}
    />
  );
});
