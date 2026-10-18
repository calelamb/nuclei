import { X } from 'lucide-react';
import { useMemo } from 'react';
import { IconButton, Dialog } from '../ui';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  KEYBINDINGS, formatKeys, isBindingAvailable, isBindingInMode, isMacPlatform, shortcutLabel,
  type KeybindingGroup, type KeybindingWorkspace,
} from '../../config/keybindings';
import { isWebBuild } from '../../platform/buildTarget';
import { ICON_SIZE } from '../../styles/tokens';
import './shortcuts.css';

interface KeyboardShortcutsProps {
  onClose: () => void;
}

interface ShortcutRow { keys: string; description: string }

/** Editor behaviours that are not global bindings but are real. */
const EDITOR_EXTRAS: Record<string, ShortcutRow> = {
  ghost: { keys: 'Tab', description: 'Accept ghost completion' },
};

const GROUP_ORDER: KeybindingGroup[] = ['Essential', 'Editor', 'Navigation', 'View', 'Run'];

/**
 * Generated from the one keybinding registry, so the sheet matches reality: it omits chords the browser keeps
 * for itself and chords that do nothing in the current workspace (the Learn level has no Research equivalent).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shortcutGroups(
  mac: boolean = isMacPlatform(),
  web: boolean = isWebBuild(),
  mode: KeybindingWorkspace = useWorkspaceStore.getState().mode,
): Array<{ title: string; shortcuts: ShortcutRow[] }> {
  return GROUP_ORDER.map((title) => {
    const rows: ShortcutRow[] = KEYBINDINGS
      .filter((b) => b.group === title && isBindingAvailable(b, web) && isBindingInMode(b, mode))
      .map((b) => ({ keys: formatKeys(b, mac), description: b.label }));
    if (title === 'Editor') rows.push(EDITOR_EXTRAS.ghost);
    return { title, shortcuts: rows };
  }).filter((g) => g.shortcuts.length > 0);
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const mode = useWorkspaceStore((s) => s.mode);
  const groups = useMemo(() => shortcutGroups(isMacPlatform(), isWebBuild(), mode), [mode]);
  const web = isWebBuild();

  return (
    <Dialog
      title="Keyboard shortcuts"
      onClose={onClose}
      width={760}
      className="shortcuts-dialog"
      zIndex={4500}
      trailing={<IconButton size="sm" aria-label="Close shortcuts" onClick={onClose}><X size={ICON_SIZE.md} /></IconButton>}
      footer={(
        <p className="shortcuts-note">
          Press {shortcutLabel('palette')} to open the command palette for all commands
          {web && ' (including New file and Toggle theme, whose keys your browser keeps for itself)'}
        </p>
      )}
    >
      <div className="shortcuts-groups">
        {groups.map((group) => (
          <section key={group.title} className="shortcuts-group">
            <h3 className="nuclei-overline shortcuts-group__title">{group.title}</h3>
            {group.shortcuts.map((s) => (
              <div key={s.description} className="shortcuts-row">
                <span className="shortcuts-row__label">{s.description}</span>
                <kbd className="shortcuts-row__keys">{s.keys}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
