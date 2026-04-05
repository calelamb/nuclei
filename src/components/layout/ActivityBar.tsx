import { Files, Search, Cpu, GraduationCap, Blocks, Settings, Server, Users } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

export type ActivityView = 'files' | 'search' | 'circuit' | 'learning' | 'plugins' | 'hardware' | 'community' | 'settings';

interface ActivityBarProps {
  active: ActivityView | null;
  onSelect: (view: ActivityView) => void;
}

const TOP_ITEMS: Array<{ id: ActivityView; icon: typeof Files; label: string }> = [
  { id: 'files', icon: Files, label: 'Explorer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'circuit', icon: Cpu, label: 'Circuit' },
  { id: 'learning', icon: GraduationCap, label: 'Learning' },
  { id: 'plugins', icon: Blocks, label: 'Plugins' },
  { id: 'hardware', icon: Server, label: 'Hardware' },
  { id: 'community', icon: Users, label: 'Community' },
];

const BOTTOM_ITEMS: Array<{ id: ActivityView; icon: typeof Settings; label: string }> = [
  { id: 'settings', icon: Settings, label: 'Settings' },
];

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

export function ActivityBar({ active, onSelect }: ActivityBarProps) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div
      style={{
        width: 48, height: '100%',
        backgroundColor: colors.bgPanel,
        display: 'flex', flexDirection: 'column',
        flexShrink: 0,
        borderRight: `1px solid ${colors.border}`,
      }}
      role="toolbar"
      aria-label="Activity bar"
      aria-orientation="vertical"
    >
      {TOP_ITEMS.map((item) => (
        <ActivityIcon
          key={item.id}
          item={item}
          isActive={active === item.id}
          onClick={() => onSelect(item.id)}
        />
      ))}
      <div style={{ flex: 1 }} />
      {BOTTOM_ITEMS.map((item) => (
        <ActivityIcon
          key={item.id}
          item={item}
          isActive={active === item.id}
          onClick={() => onSelect(item.id)}
        />
      ))}
    </div>
  );
}
