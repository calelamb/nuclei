import { modeChipHoverTint, modeChipTint } from './modeChipTint';
import './modeChip.css';
import { GraduationCap, FlaskConical } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useWorkspaceStore, type WorkspaceMode } from '../../stores/workspaceStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';

import { TYPOGRAPHY } from '../../styles/tokens';
import { Menu, Tooltip, type MenuEntry } from '../ui';
import { shortcutLabel } from '../../config/keybindings';
/**
 * PRD 11 Phase B — the mode chip.
 *
 * Far-left of the status bar; the always-visible answer to "which mode am I
 * in" (text label + accent colour, never colour alone — D6). Click opens a
 * small switch menu (Learn / Research). Switching routes through
 * `modeSwitchStore.requestSwitch`, which confirms first if a sweep/campaign
 * is running (and never cancels it).
 *
 * The accent is the Research blue for Research and quantum teal for Learn.
 * Purple is reserved for Dirac. Teal text/icons use `accentText` (AA on every
 * surface); the raw `accent` only tints the fill and border.
 *
 * The menu is the shared `ui/Menu`, so it behaves exactly like the Level menu:
 * it opens on the checked mode and roves with the arrow keys.
 */

const MODE_META: Record<WorkspaceMode, { label: string; menuLabel: string; icon: typeof GraduationCap }> = {
  learn: { label: 'LEARN', menuLabel: 'Learn quantum computing', icon: GraduationCap },
  research: { label: 'RESEARCH', menuLabel: 'Research workspace', icon: FlaskConical },
};
const MODES: ReadonlyArray<WorkspaceMode> = ['learn', 'research'];

export function ModeChip() {
  const colors = useThemeStore((s) => s.colors);
  const mode = useWorkspaceStore((s) => s.mode);
  const requestSwitch = useModeSwitchStore((s) => s.requestSwitch);

  const accent = mode === 'research' ? colors.modeResearch : colors.accent;
  const accentText = mode === 'research' ? colors.modeResearch : colors.accentText;
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  const entries: MenuEntry[] = MODES.map((m) => {
    const MIcon = MODE_META[m].icon;
    const tint = m === 'research' ? colors.modeResearch : colors.accentText;
    return {
      id: m,
      label: MODE_META[m].menuLabel,
      icon: <MIcon size={14} color={tint} strokeWidth={2} />,
      checked: m === mode,
      onSelect: () => requestSwitch(m),
    };
  });

  return (
    <Menu
      label="Switch workspace mode"
      placement="top-start"
      minWidth={200}
      entries={entries}
      trigger={(p) => (
        <Tooltip label="Switch workspace mode" shortcut={shortcutLabel('switch-workspace')} placement="above">
          <button
            {...p}
            className="mode-chip"
            aria-label="Switch workspace mode"
            data-tour-target="mode-chip"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              height: 20,
              padding: '0 8px',
              ['--mode-chip-accent' as string]: accent,
              ['--mode-chip-rest' as string]: modeChipTint(accent),
              ['--mode-chip-hover' as string]: modeChipHoverTint(accent),
              border: `1px solid ${accent}`,
              borderRadius: 4,
              cursor: 'pointer',
              color: accentText,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              fontFamily: TYPOGRAPHY.fontSans,
            }}
          >
            <Icon size={12} strokeWidth={2.2} />
            {meta.label}
          </button>
        </Tooltip>
      )}
    />
  );
}
