import { useThemeStore } from '../../stores/themeStore';

const SHORTCUTS = [
  { keys: '⌘ + Enter', description: 'Run circuit simulation' },
  { keys: '⌘ + S', description: 'Save file' },
  { keys: '⌘ + Shift + S', description: 'Save as...' },
  { keys: '⌘ + O', description: 'Open file' },
  { keys: '⌘ + N', description: 'New file' },
  { keys: '⌘ + /', description: 'Keyboard shortcuts' },
];

export function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 3000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }} onClick={onClose}>
      <div style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 24,
        maxWidth: 360,
        width: '90%',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ color: colors.accent, fontSize: 16, fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
            Keyboard Shortcuts
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        {SHORTCUTS.map((s, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 0',
            borderBottom: i < SHORTCUTS.length - 1 ? `1px solid ${colors.border}` : 'none',
          }}>
            <span style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
              {s.description}
            </span>
            <kbd style={{
              color: colors.accent,
              fontSize: 12,
              fontFamily: "'Fira Code', monospace",
              background: colors.bgPanel,
              padding: '2px 8px',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
            }}>
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
