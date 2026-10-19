import { X } from 'lucide-react';
import { useMemo } from 'react';
import { IconButton, Dialog } from '../ui';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { isLearnEnabled, useLearnGateStore } from '../../stores/learnGateStore';
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

const GROUP_ORDER: KeybindingGroup[] = ['Essential', 'Editor', 'Navigation', 'View'];

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
  const groups = GROUP_ORDER.map((title) => {
    const rows: ShortcutRow[] = KEYBINDINGS
      .filter((b) => b.group === title && isBindingAvailable(b, web) && isBindingInMode(b, mode) && (b.id !== 'switch-workspace' || isLearnEnabled()))
      .map((b) => ({ keys: formatKeys(b, mac), description: b.label }));
    if (title === 'Editor') rows.push(EDITOR_EXTRAS.ghost);
    return { title, shortcuts: rows };
  }).filter((g) => g.shortcuts.length > 0);
  return foldSmallGroups(groups);
}

type ShortcutGroup = { title: string; shortcuts: ShortcutRow[] };
const MIN_GROUP_ROWS = 3;

/** A heading over one or two rows reads as clutter: fold such a group into the one before it, judged by the rows actually shown. */
function foldSmallGroups(groups: ShortcutGroup[]): ShortcutGroup[] {
  return groups.reduce<ShortcutGroup[]>((acc, group) => {
    const prev = acc[acc.length - 1];
    if (!prev || group.shortcuts.length >= MIN_GROUP_ROWS) return [...acc, group];
    const merged = { title: `${prev.title} & ${group.title.toLowerCase()}`, shortcuts: [...prev.shortcuts, ...group.shortcuts] };
    return [...acc.slice(0, -1), merged];
  }, []);
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const mode = useWorkspaceStore((s) => s.mode);
  const learnEnabled = useLearnGateStore((s) => s.learnEnabled);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- learnEnabled is read inside shortcutGroups
  const groups = useMemo(() => shortcutGroups(isMacPlatform(), isWebBuild(), mode), [mode, learnEnabled]);
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
