import { IconButton } from '../ui';
import { X } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { EASING, DURATION, prefersReducedMotion } from '../../lib/animations';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { KEYBINDINGS, formatKeys, isBindingAvailable, isMacPlatform, shortcutLabel, type KeybindingGroup } from '../../config/keybindings';
import { isWebBuild } from '../../platform/buildTarget';

import { TYPOGRAPHY } from '../../styles/tokens';
interface KeyboardShortcutsProps {
  onClose: () => void;
}

interface ShortcutRow { keys: string; description: string }

/** Editor behaviours that are not global bindings but are real. */
const EDITOR_EXTRAS: Record<string, ShortcutRow> = {
  ghost: { keys: 'Tab', description: 'Accept ghost completion' },
};

const GROUP_ORDER: KeybindingGroup[] = ['Essential', 'Editor', 'Navigation', 'View'];

/** Generated from the one keybinding registry, so the sheet matches reality. */
// eslint-disable-next-line react-refresh/only-export-components
export function shortcutGroups(mac: boolean = isMacPlatform(), web: boolean = isWebBuild()): Array<{ title: string; shortcuts: ShortcutRow[] }> {
  return GROUP_ORDER.map((title) => {
    const rows: ShortcutRow[] = KEYBINDINGS.filter((b) => b.group === title && isBindingAvailable(b, web)).map((b) => ({
      keys: formatKeys(b, mac),
      description: b.label,
    }));
    if (title === 'Editor') rows.push(EDITOR_EXTRAS.ghost);
    return { title, shortcuts: rows };
  });
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  useEscapeToClose(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const groups = useMemo(() => shortcutGroups(), []);
  const web = isWebBuild();

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 4500,
        background: colors.scrim,
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.fast}ms`,
      }}
      onClick={onClose}
      ref={dialogRef}
      tabIndex={-1}
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
          boxShadow: shadow.lg,
          animation: prefersReducedMotion() ? 'none' : `nuclei-slide-up ${DURATION.normal}ms ${EASING.spring}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{
            color: colors.text, fontSize: 16, fontWeight: 600,
            fontFamily: TYPOGRAPHY.fontSans,
          }}>
            Keyboard shortcuts
          </h2>
          <IconButton aria-label="Close shortcuts" onClick={onClose}><X size={16} /></IconButton>
        </div>

        {groups.map((group) => (
          <div key={group.title} style={{ marginBottom: 16 }}>
            <div style={{
              color: colors.accentText, fontSize: 11, fontWeight: 600,
              fontFamily: TYPOGRAPHY.fontSans,
              textTransform: 'uppercase', letterSpacing: 0.5,
              marginBottom: 6,
            }}>
              {group.title}
            </div>
            {group.shortcuts.map((s) => (
              <div key={s.description} style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '5px 0',
              }}>
                <span style={{
                  color: colors.text, fontSize: 13,
                  fontFamily: TYPOGRAPHY.fontSans,
                }}>
                  {s.description}
                </span>
                <kbd style={{
                  fontSize: 12,
                  fontFamily: TYPOGRAPHY.fontMono,
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
          fontFamily: TYPOGRAPHY.fontSans,
          textAlign: 'center', marginTop: 8,
        }}>
          Press {shortcutLabel('palette')} to open the command palette for all commands
          {web && ' (including New file and Toggle theme, whose keys your browser keeps for itself)'}
        </div>
      </div>
    </div>
  );
}
