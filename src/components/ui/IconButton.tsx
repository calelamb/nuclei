import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: an icon-only control has no other accessible name. Also used as the native tooltip unless `tooltip` is set. */
  'aria-label': string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
  /** Use the shared <Tooltip> (with an optional shortcut glyph) instead of a native title. */
  tooltip?: { label?: string; shortcut?: string; placement?: 'above' | 'below' | 'right' };
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', className, title, type = 'button', tooltip, ...rest },
  ref,
) {
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      title={tooltip ? undefined : title ?? rest['aria-label']}
      className={cx('nuclei-icon-btn', `nuclei-icon-btn--${variant}`, `nuclei-icon-btn--${size}`, className)}
    />
  );
  if (!tooltip) return button;
  return (
    <Tooltip label={tooltip.label ?? rest['aria-label']} shortcut={tooltip.shortcut} placement={tooltip.placement}>
      {button}
    </Tooltip>
  );
});
