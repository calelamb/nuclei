import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { Search } from 'lucide-react';
import type { ChallengeDifficulty, ChallengeCategory } from '../../types/challenge';

const DIFFICULTIES: Array<{ label: string; value: ChallengeDifficulty | null }> = [
  { label: 'All', value: null },
  { label: 'Easy', value: 'easy' },
  { label: 'Medium', value: 'medium' },
  { label: 'Hard', value: 'hard' },
];

const DIFFICULTY_ACCENT: Record<string, string> = {
  easy: '#10B981',
  medium: '#F59E0B',
  hard: '#EF4444',
};

const CATEGORIES: Array<{ label: string; value: ChallengeCategory | null }> = [
  { label: 'All', value: null },
  { label: 'State Prep', value: 'state-preparation' },
  { label: 'Algorithms', value: 'algorithms' },
  { label: 'Optimization', value: 'optimization' },
  { label: 'Protocols', value: 'protocols' },
];

const STATUS_OPTIONS: Array<{ label: string; value: 'all' | 'not_started' | 'attempted' | 'solved' }> = [
  { label: 'All', value: 'all' },
  { label: 'Not Started', value: 'not_started' },
  { label: 'Attempted', value: 'attempted' },
  { label: 'Solved', value: 'solved' },
];

function PillButton({ active, label, accentColor, onClick }: {
  active: boolean;
  label: string;
  accentColor?: string;
  onClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const tint = accentColor ?? colors.accent;

  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 6,
        border: `1px solid ${active ? tint : colors.border}`,
        background: active ? `${tint}18` : 'transparent',
        color: active ? tint : colors.textMuted,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        fontFamily: "'Geist Sans', sans-serif",
        cursor: 'pointer',
        transition: 'all 150ms ease',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = colors.borderStrong;
          e.currentTarget.style.color = colors.text;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = colors.border;
          e.currentTarget.style.color = colors.textMuted;
        }
      }}
    >
      {label}
    </button>
  );
}

export function ProblemFilters() {
  const colors = useThemeStore((s) => s.colors);
  const difficultyFilter = useChallengeModeStore((s) => s.difficultyFilter);
  const categoryFilter = useChallengeModeStore((s) => s.categoryFilter);
  const statusFilter = useChallengeModeStore((s) => s.statusFilter);
  const searchQuery = useChallengeModeStore((s) => s.searchQuery);
  const setDifficultyFilter = useChallengeModeStore((s) => s.setDifficultyFilter);
  const setCategoryFilter = useChallengeModeStore((s) => s.setCategoryFilter);
  const setStatusFilter = useChallengeModeStore((s) => s.setStatusFilter);
  const setSearchQuery = useChallengeModeStore((s) => s.setSearchQuery);

  return (
    <div style={{
      padding: '12px 24px',
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      background: colors.bgPanel,
    }}>
      {/* Search row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 6,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
      }}>
        <Search size={14} color={colors.textDim} />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search challenges..."
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: colors.text,
            fontSize: 13,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        />
      </div>

      {/* Filter pills row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        {/* Difficulty pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            color: colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
            marginRight: 4,
          }}>
            Difficulty
          </span>
          {DIFFICULTIES.map((d) => (
            <PillButton
              key={d.label}
              label={d.label}
              active={difficultyFilter === d.value}
              accentColor={d.value ? DIFFICULTY_ACCENT[d.value] : undefined}
              onClick={() => setDifficultyFilter(d.value)}
            />
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: colors.border }} />

        {/* Category pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            color: colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
            marginRight: 4,
          }}>
            Category
          </span>
          {CATEGORIES.map((c) => (
            <PillButton
              key={c.label}
              label={c.label}
              active={categoryFilter === c.value}
              onClick={() => setCategoryFilter(c.value)}
            />
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: colors.border }} />

        {/* Status pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            color: colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
            marginRight: 4,
          }}>
            Status
          </span>
          {STATUS_OPTIONS.map((s) => (
            <PillButton
              key={s.value}
              label={s.label}
              active={statusFilter === s.value}
              onClick={() => setStatusFilter(s.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
