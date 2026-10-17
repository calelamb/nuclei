import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'research' | 'dirac';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Optional leading dot or icon. */
  icon?: ReactNode;
}

/** Small status pill. Colour comes from tone tokens; text always meets AA. */
export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx('nuclei-badge', `nuclei-badge--${tone}`, className)}>
      {icon}
      {children}
    </span>
  );
}
