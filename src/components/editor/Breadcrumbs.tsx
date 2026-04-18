import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { ChevronRight, MoreHorizontal } from 'lucide-react';

const MAX_VISIBLE_SEGMENTS = 3;

export function Breadcrumbs() {
  const filePath = useEditorStore((s) => s.filePath);
  const colors = useThemeStore((s) => s.colors);

  const allSegments = filePath
    ? filePath.split(/[\\/]/).filter(Boolean)
    : ['untitled.py'];

  // Avoid leaking absolute path prefixes like /Users/<name>/... — show at
  // most the last N segments with a leading ellipsis marker when truncated.
  // This matches the convention used in status-bar paths across modern
  // editors and keeps breadcrumbs legible on small screens.
  const truncated = allSegments.length > MAX_VISIBLE_SEGMENTS;
  const visible = truncated
    ? allSegments.slice(-MAX_VISIBLE_SEGMENTS)
    : allSegments;

  return (
    <div style={{
      height: 22,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 2,
      backgroundColor: colors.bgEditor,
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {truncated && (
        <span
          title={filePath ?? undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 2, color: colors.textDim }}
        >
          <MoreHorizontal size={11} />
          <ChevronRight size={10} />
        </span>
      )}
      {visible.map((seg, i) => {
        const isLast = i === visible.length - 1;
        return (
          <span key={`${seg}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && <ChevronRight size={10} style={{ color: colors.textDim }} />}
            <span
              style={{
                fontSize: 11,
                fontFamily: "'Geist Sans', system-ui, sans-serif",
                color: isLast ? colors.textMuted : colors.textDim,
                whiteSpace: 'nowrap',
              }}
            >
              {seg}
            </span>
          </span>
        );
      })}
    </div>
  );
}
