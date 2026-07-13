import { useThemeStore } from '../../stores/themeStore';

/** Designed empty state for the QEC panels (PRD 10 Phase D / PRD 11 D5): one
 * sentence of what/why, never a blank box. */
export function QecEmptyState({ title, body }: { title: string; body: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 6, padding: 24, textAlign: 'center',
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.textMuted }}>{title}</div>
      <div style={{ fontSize: 11.5, color: colors.textDim, maxWidth: 320, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}
