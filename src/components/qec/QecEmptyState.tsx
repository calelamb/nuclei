import type { ReactNode } from 'react';
import { useThemeStore } from '../../stores/themeStore';

import { Button } from '../ui';
import { TYPOGRAPHY } from '../../styles/tokens';
export interface QecEmptyStateAction {
  label: string;
  onClick: () => void;
}

/** Designed empty state for the Research panels (PRD 10 Phase D / PRD 11
 * Phase D): one sentence of what/why, an optional primary action, and an
 * optional docs link — never a blank box. */
export function QecEmptyState({
  title,
  body,
  action,
  docsHref,
  children,
}: {
  title: string;
  body: string;
  action?: QecEmptyStateAction;
  docsHref?: string;
  /** Extra content under the actions (e.g. a file drop zone). */
  children?: ReactNode;
}) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center',
        fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.textMuted }}>{title}</div>
      <div style={{ fontSize: 12, color: colors.textDim, maxWidth: 320, lineHeight: 1.5 }}>{body}</div>
      {(action || docsHref) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          {action && (
            <Button variant="primary" onClick={action.onClick}>{action.label}</Button>
          )}
          {docsHref && (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: colors.accent, textDecoration: 'none' }}
            >
              Read the docs →
            </a>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
