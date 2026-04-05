import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { ChevronRight } from 'lucide-react';

export function Breadcrumbs() {
  const filePath = useEditorStore((s) => s.filePath);
  const colors = useThemeStore((s) => s.colors);

  const segments = filePath
    ? filePath.split('/').filter(Boolean)
    : ['untitled.py'];

  return (
    <div style={{
      height: 22, display: 'flex', alignItems: 'center',
      padding: '0 12px', gap: 2,
      backgroundColor: colors.bgEditor,
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {segments.map((seg, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {i > 0 && <ChevronRight size={10} style={{ color: colors.textDim }} />}
          <span
            style={{
              fontSize: 11,
              fontFamily: "'Geist Sans', system-ui, sans-serif",
              color: i === segments.length - 1 ? colors.textMuted : colors.textDim,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = i === segments.length - 1 ? colors.textMuted : colors.textDim; }}
          >
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}
