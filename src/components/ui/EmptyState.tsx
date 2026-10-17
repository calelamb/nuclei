import type { ReactNode } from 'react';
import { cx } from './cx';

export interface EmptyStateProps {
  /** A lucide icon element at ICON_SIZE.lg (20px); rendered in the tertiary text colour. */
  icon?: ReactNode;
  title: string;
  /** One or two short sentences; capped at 32 characters wide. */
  children?: ReactNode;
  /** Optional single call to action (a `<Button size="sm">`). */
  action?: ReactNode;
  className?: string;
}

/**
 * The shared empty state: a quiet 20px icon, a 13/600 title, a 12/400 secondary
 * line and at most one action. Centered in whatever space it is given.
 */
export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx('nuclei-empty', className)}>
      {icon && <span className="nuclei-empty__icon" aria-hidden="true">{icon}</span>}
      <p className="nuclei-empty__title">{title}</p>
      {children && <p className="nuclei-empty__body">{children}</p>}
      {action && <div className="nuclei-empty__action">{action}</div>}
    </div>
  );
}
