import { useThemeStore } from '../../stores/themeStore';
import { EASING, DURATION, prefersReducedMotion } from '../../lib/animations';

interface KeyboardShortcutsProps {
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Essential',
    shortcuts: [
      { keys: '⌘+Enter', description: 'Run circuit' },
      { keys: '⌘+S', description: 'Save file' },
      { keys: '⌘+Shift+P', description: 'Command palette' },
      { keys: '⌘+D', description: 'Toggle Dirac panel' },
      { keys: '⌘+L', description: 'Focus Dirac input' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: '⌘+K', description: 'Inline edit (with selection)' },
      { keys: 'Tab', description: 'Accept ghost completion' },
      { keys: '⌘+.', description: 'Quick fix / code action' },
      { keys: '⌘+F', description: 'Find' },
      { keys: '⌘+H', description: 'Find and replace' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: '⌘+O', description: 'Open file' },
      { keys: '⌘+N', description: 'New file' },
      { keys: '⌘+J', description: 'Toggle bottom panel' },
      { keys: '⌘+Shift+L', description: 'Cycle UI mode' },
      { keys: '⌘+Shift+T', description: 'Toggle theme' },
    ],
  },
  {
    title: 'Circuit',
    shortcuts: [
      { keys: '⌘+→', description: 'Step forward' },
      { keys: '⌘+←', description: 'Step backward' },
      { keys: 'Esc', description: 'Exit step-through / focus editor' },
    ],
  },
];

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 4500,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.fast}ms`,
      }}
      onClick={onClose}
      role="dialog"
      aria-label="Keyboard shortcuts"
      aria-modal="true"
    >
      <div
        style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 24,
          maxWidth: 520, width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.normal}ms ${EASING.spring}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{
            color: colors.text, fontSize: 18, fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: colors.textMuted, cursor: 'pointer',
              fontSize: 16, padding: '4px 8px',
            }}
            aria-label="Close shortcuts"
          >
            ×
          </button>
        </div>

        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: 16 }}>
            <div style={{
              color: colors.accent, fontSize: 11, fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              textTransform: 'uppercase', letterSpacing: 0.5,
              marginBottom: 6,
            }}>
              {group.title}
            </div>
            {group.shortcuts.map((s) => (
              <div key={s.keys} style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '5px 0',
              }}>
                <span style={{
                  color: colors.text, fontSize: 13,
                  fontFamily: "'Geist Sans', sans-serif",
                }}>
                  {s.description}
                </span>
                <kbd style={{
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: colors.textMuted,
                  background: colors.bgPanel,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  whiteSpace: 'nowrap',
                }}>
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        ))}

        <div style={{
          color: colors.textDim, fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
          textAlign: 'center', marginTop: 8,
        }}>
          Press ⌘+Shift+P to open the command palette for all commands
        </div>
      </div>
    </div>
  );
}
