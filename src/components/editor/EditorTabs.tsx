import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { X, FileCode } from 'lucide-react';

export function EditorTabs() {
  const filePath = useEditorStore((s) => s.filePath);
  const isDirty = useEditorStore((s) => s.isDirty);
  const colors = useThemeStore((s) => s.colors);

  const fileName = filePath
    ? filePath.split('/').pop() ?? 'untitled.py'
    : 'untitled.py';

  return (
    <div style={{
      height: 32, display: 'flex', alignItems: 'stretch',
      backgroundColor: colors.bgPanel,
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* Active tab */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 12px',
          backgroundColor: colors.bgEditor,
          borderBottom: `2px solid ${colors.accent}`,
          fontSize: 12,
          fontFamily: "'Geist Sans', system-ui, sans-serif",
          color: colors.text,
          cursor: 'default',
          maxWidth: 200,
          position: 'relative',
        }}
      >
        <FileCode size={13} style={{ color: colors.accent, flexShrink: 0 }} />
        {isDirty && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: colors.warning, flexShrink: 0,
          }} />
        )}
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {fileName}
        </span>
        <button
          title="Close tab"
          style={{
            background: 'none', border: 'none', padding: 2,
            color: colors.textDim, cursor: 'pointer',
            display: 'flex', alignItems: 'center',
            borderRadius: 3, flexShrink: 0,
            opacity: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = colors.bgElevated; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
          aria-label="Close tab"
        >
          <X size={12} />
        </button>
      </div>
      {/* Rest of tab bar — empty space matches panel bg */}
      <div style={{ flex: 1, backgroundColor: colors.bgPanel }} />
    </div>
  );
}
