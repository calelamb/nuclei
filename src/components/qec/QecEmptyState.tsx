import type { ReactNode } from 'react';
import { Button, EmptyState } from '../ui';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { ChartSpline } from 'lucide-react';

export interface QecEmptyStateAction {
  label: string;
  onClick: () => void;
}

/**
 * The Research panels' empty state: the shared EmptyState (icon, 13/600 title,
 * secondary line, one action) plus an optional docs link and any extra content
 * such as a CSV drop zone. Never a blank box.
 */
export function QecEmptyState({
  title,
  body,
  action,
  docsHref,
  align = 'center',
  children,
}: {
  title: string;
  body: string;
  action?: QecEmptyStateAction;
  docsHref?: string;
  /** 'top' anchors the message under whatever is above it instead of centring it in the remaining height. */
  align?: 'center' | 'top';
  /** Extra content under the actions (e.g. a file drop zone). */
  children?: ReactNode;
}) {
  const primary = action ? <Button variant="primary" onClick={action.onClick}>{action.label}</Button> : undefined;
  return (
    <div className={`qec-empty qec-empty--${align}`}>
      <EmptyState icon={<ChartSpline size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} />} title={title} action={primary}>
        {body}
      </EmptyState>
      {docsHref && (
        <a className="qec-empty__docs" href={docsHref} target="_blank" rel="noreferrer">Read the docs →</a>
      )}
      {children}
    </div>
  );
}
