import { Files, Search, Cpu, GraduationCap, Blocks, Settings, Server, Users, Trophy, Rocket, FlaskConical } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
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
  | 'experiments';

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
};

function ActivityIcon({ item, isActive, onClick }: {
  item: { id: ActivityView; icon: typeof Files; label: string };
  isActive: boolean;
  onClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      title={item.label}
      aria-label={item.label}
      aria-pressed={isActive}
      data-tour-target={`activity-${item.id}`}
      style={{
        width: 48, height: 44,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        borderLeft: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
        cursor: 'pointer',
        color: isActive ? colors.text : colors.textDim,
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.color = colors.textMuted;
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.color = colors.textDim;
      }}
    >
      <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
    </button>
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
        // Mode signature (PRD 11 Phase B): a 2px accent stripe driven by the
        // --mode-accent variable useModeIdentity sets from the workspace mode
        // (teal in Learn, violet in Research). Falls back to transparent so a
        // context without the variable is unchanged.
        borderTop: '2px solid var(--mode-accent, transparent)',
      }}
      role="toolbar"
      aria-label="Activity bar"
      aria-orientation="vertical"
    >
      {topViews.map((id) => (
        <ActivityIcon
          key={id}
          item={{ id, ...ITEM_META[id] }}
          isActive={active === id}
          onClick={() => onSelect(id)}
        />
      ))}
      <div style={{ flex: 1 }} />
      {bottomViews.map((id) => (
        <ActivityIcon
          key={id}
          item={{ id, ...ITEM_META[id] }}
          isActive={active === id}
          onClick={() => onSelect(id)}
        />
      ))}
    </div>
  );
}
