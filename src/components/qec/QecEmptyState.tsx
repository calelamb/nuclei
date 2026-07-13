import { useThemeStore } from '../../stores/themeStore';

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
}: {
  title: string;
  body: string;
  action?: QecEmptyStateAction;
  docsHref?: string;
}) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center',
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.textMuted }}>{title}</div>
      <div style={{ fontSize: 11.5, color: colors.textDim, maxWidth: 320, lineHeight: 1.5 }}>{body}</div>
      {(action || docsHref) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              style={{
                padding: '5px 12px', borderRadius: 5, border: `1px solid ${colors.accent}`,
                background: colors.accent, color: colors.bg, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
              }}
            >
              {action.label}
            </button>
          )}
          {docsHref && (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11.5, color: colors.accent, textDecoration: 'none' }}
            >
              Read the docs →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
