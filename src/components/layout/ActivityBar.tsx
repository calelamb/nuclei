import { Files, Search, Cpu, GraduationCap, Blocks, Settings, Server, Users, Trophy, Rocket, FlaskConical, Calculator, Shuffle, Atom } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { Tooltip } from '../ui/Tooltip';
import { railShortcutLabel, shortcutLabel } from '../../config/keybindings';
import './activityBar.css';
import { bottomViewsForMode } from './panelRegistry';
import type { WorkspaceMode } from '../../stores/workspaceStore';

export type ActivityView =
  | 'files'
  | 'search'
  | 'circuit'
  | 'learning'
  | 'challenges'
  | 'plugins'
  | 'hardware'
  | 'launch'
  | 'community'
  | 'settings'
  | 'experiments'
  | 'qec'
  | 'estimator'
  | 'transpiler';

interface ActivityBarProps {
  active: ActivityView | null;
  onSelect: (view: ActivityView) => void;
  /**
   * The ordered list of views to render, already filtered for the current
   * workspace mode (and, in Learn mode, `experimentalFeatures`). Computed
   * once at the registration point via `activityViewsForMode` — see
   * `panelRegistry.ts` — rather than re-derived here.
   */
  visibleViews: ActivityView[];
  /** Workspace mode — only used to pick which views are "bottom-pinned". */
  workspaceMode: WorkspaceMode;
}

const ITEM_META: Record<ActivityView, { icon: typeof Files; label: string }> = {
  files: { icon: Files, label: 'Explorer' },
  learning: { icon: GraduationCap, label: 'Learning' },
  challenges: { icon: Trophy, label: 'Challenges' },
  launch: { icon: Rocket, label: 'Launch' },
  search: { icon: Search, label: 'Search' },
  circuit: { icon: Cpu, label: 'Circuit' },
  plugins: { icon: Blocks, label: 'Plugins' },
  hardware: { icon: Server, label: 'Hardware' },
  community: { icon: Users, label: 'Community' },
  settings: { icon: Settings, label: 'Settings' },
  experiments: { icon: FlaskConical, label: 'Experiments' },
  qec: { icon: Atom, label: 'QEC Workbench' },
  estimator: { icon: Calculator, label: 'Resource Estimator' },
  transpiler: { icon: Shuffle, label: 'Transpiler' },
};

function ActivityIcon({ item, isActive, onClick, shortcut }: {
  item: { id: ActivityView; icon: typeof Files; label: string };
  isActive: boolean;
  onClick: () => void;
  /** ⌘N binding shown in the tooltip (PRD 11 Phase D) — top-rail views only. */
  shortcut?: string;
}) {
  const colors = useThemeStore((s) => s.colors);
  const Icon = item.icon;

  return (
    <Tooltip label={item.label} shortcut={shortcut} placement="right">
      <button
        onClick={onClick}
        aria-label={item.label}
        aria-pressed={isActive}
        data-active={isActive}
        className="nuclei-quiet activity-btn"
        data-tour-target={`activity-${item.id}`}
        style={{
          width: 48, height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          borderLeft: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
      </button>
    </Tooltip>
  );
}

export function ActivityBar({ active, onSelect, visibleViews, workspaceMode }: ActivityBarProps) {
  const colors = useThemeStore((s) => s.colors);
  const bottomIds = new Set(bottomViewsForMode(workspaceMode));
  const topViews = visibleViews.filter((id) => !bottomIds.has(id));
  const bottomViews = visibleViews.filter((id) => bottomIds.has(id));

  return (
    <div
      style={{
        width: 48, height: '100%',
        backgroundColor: colors.bgPanel,
        display: 'flex', flexDirection: 'column',
        flexShrink: 0,
        borderRight: `1px solid ${colors.border}`,
        // The mode identity lives in the status-bar chip; a 2px stripe over only the 48px rail read as a stray line.
      }}
      role="toolbar"
      aria-label="Activity bar"
      aria-orientation="vertical"
    >
      {topViews.map((id, i) => (
        <ActivityIcon
          key={id}
          item={{ id, ...ITEM_META[id] }}
          isActive={active === id}
          onClick={() => onSelect(id)}
          // ⌘1..9 map onto the first nine top-rail views (PRD 11 Phase D).
          shortcut={railShortcutLabel(i)}
        />
      ))}
      <div style={{ flex: 1 }} />
      {bottomViews.map((id) => (
        <ActivityIcon
          key={id}
          item={{ id, ...ITEM_META[id] }}
          isActive={active === id}
          onClick={() => onSelect(id)}
          shortcut={id === 'settings' ? shortcutLabel('settings') : undefined}
        />
      ))}
    </div>
  );
}
