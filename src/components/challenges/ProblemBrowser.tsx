import { useEffect, useMemo } from 'react';
import { CheckCircle2, Circle, Clock3, ListChecks, ShieldCheck } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import {
  type ChallengePracticeTab,
  filterChallenges,
  useChallengeModeStore,
} from '../../stores/challengeModeStore';
import { QUANTUM_CHALLENGES } from '../../data/challenges';
import { ProblemFilters } from './ProblemFilters';
import type {
  ChallengeCategory,
  ChallengeDifficulty,
  ProblemProgress,
  ProblemStatus,
  QuantumChallenge,
} from '../../types/challenge';

const DIFFICULTY_COLORS: Record<ChallengeDifficulty, string> = {
  easy: '#10B981',
  medium: '#F59E0B',
  hard: '#EF4444',
};

const CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  'state-preparation': 'State Prep',
  algorithms: 'Algorithms',
  optimization: 'Optimization',
  protocols: 'Protocols',
};

const STATUS_LABELS: Record<ProblemStatus, string> = {
  not_started: 'Not Started',
  attempted: 'Attempted',
  solved: 'Solved',
};

const PRACTICE_TABS: Array<{
  value: ChallengePracticeTab;
  label: string;
  detail: string;
  icon: typeof ListChecks;
}> = [
  {
    value: 'all',
    label: 'All Practice',
    detail: 'Circuit builders and protocol drills',
    icon: ListChecks,
  },
  {
    value: 'qkd',
    label: 'QKD Protocols',
    detail: 'BB84, QBER, intercept-resend, E91',
    icon: ShieldCheck,
  },
];

function PracticeTabButton({
  active,
  tab,
  count,
  onClick,
}: {
  active: boolean;
  tab: (typeof PRACTICE_TABS)[number];
  count: number;
  onClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const Icon = tab.icon;

  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minWidth: 220,
        padding: '10px 14px',
        borderRadius: 8,
        border: `1px solid ${active ? colors.accent : colors.border}`,
        background: active
          ? `linear-gradient(135deg, ${colors.accent}26, ${colors.bgElevated})`
          : colors.bg,
        color: active ? colors.text : colors.textMuted,
        cursor: 'pointer',
        textAlign: 'left',
        boxShadow: active ? `0 0 24px ${colors.accent}18 inset` : 'none',
        overflow: 'hidden',
      }}
    >
      <span style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: `1px solid ${active ? `${colors.accent}80` : colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? colors.accent : colors.textDim,
        background: active ? `${colors.accent}14` : colors.bgPanel,
        flexShrink: 0,
      }}>
        <Icon size={15} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "'Geist Sans', sans-serif",
          color: active ? colors.text : colors.textMuted,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {tab.label}
        </span>
        <span style={{
          display: 'block',
          marginTop: 2,
          fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
          color: colors.textDim,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {tab.detail}
        </span>
      </span>
      <span style={{
        padding: '2px 7px',
        borderRadius: 999,
        background: active ? `${colors.accent}20` : colors.bgPanel,
        color: active ? colors.accent : colors.textDim,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
      }}>
        {count}
      </span>
    </button>
  );
}

function StatusCell({ status }: { status: ProblemStatus }) {
  const colors = useThemeStore((s) => s.colors);

  if (status === 'solved') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.success }}>
        <CheckCircle2 size={14} />
        <span>Solved</span>
      </div>
    );
  }

  if (status === 'attempted') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.warning }}>
        <Circle size={14} fill={colors.warning} stroke="none" />
        <span>Attempted</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textDim }}>
      <Circle size={14} />
      <span>Not Started</span>
    </div>
  );
}

function ProblemRow({
  challenge,
  progress,
  onClick,
}: {
  challenge: QuantumChallenge;
  progress?: ProblemProgress;
  onClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const status = progress?.status ?? 'not_started';
  const attempts = progress?.attempts ?? 0;
  const solved = status === 'solved';
  const bestScore = progress?.bestScore ?? 0;

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: '150px minmax(260px, 2fr) 110px 130px 110px 130px',
        gap: 16,
        alignItems: 'center',
        padding: '14px 20px',
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${colors.border}`,
        color: colors.text,
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = colors.bgElevated;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        <StatusCell status={status} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{
          color: colors.text,
          fontSize: 14,
          fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {challenge.title}
        </div>
        <div style={{
          color: colors.textMuted,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {challenge.tags.slice(0, 3).join(' • ')}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          padding: '3px 9px',
          borderRadius: 999,
          background: `${DIFFICULTY_COLORS[challenge.difficulty]}18`,
          color: DIFFICULTY_COLORS[challenge.difficulty],
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
          textTransform: 'capitalize',
        }}>
          {challenge.difficulty}
        </span>
      </div>

      <span style={{
        color: colors.textMuted,
        fontSize: 12,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        {CATEGORY_LABELS[challenge.category]}
      </span>

      <span style={{
        color: colors.textMuted,
        fontSize: 12,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        {Math.round(challenge.acceptanceRate * 100)}%
      </span>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        color: colors.textMuted,
        fontSize: 12,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        <span>{solved ? 'Accepted' : `${STATUS_LABELS[status]}`}</span>
        <span>
          {attempts > 0 ? `${attempts} / ${bestScore}%` : '0 / --'}
        </span>
      </div>
    </button>
  );
}

export function ProblemBrowser() {
  const colors = useThemeStore((s) => s.colors);
  const setChallenges = useChallengeModeStore((s) => s.setChallenges);
  const challenges = useChallengeModeStore((s) => s.challenges);
  const difficultyFilter = useChallengeModeStore((s) => s.difficultyFilter);
  const categoryFilter = useChallengeModeStore((s) => s.categoryFilter);
  const searchQuery = useChallengeModeStore((s) => s.searchQuery);
  const statusFilter = useChallengeModeStore((s) => s.statusFilter);
  const practiceTab = useChallengeModeStore((s) => s.practiceTab);
  const progress = useChallengeModeStore((s) => s.progress);
  const setActiveProblem = useChallengeModeStore((s) => s.setActiveProblem);
  const setPracticeTab = useChallengeModeStore((s) => s.setPracticeTab);

  useEffect(() => {
    if (challenges.length === 0) {
      setChallenges(QUANTUM_CHALLENGES);
    }
  }, [challenges.length, setChallenges]);

  const filtered = useMemo(() => (
    filterChallenges(
      challenges,
      difficultyFilter,
      categoryFilter,
      searchQuery,
      statusFilter,
      progress,
      practiceTab,
    )
  ), [
    challenges,
    difficultyFilter,
    categoryFilter,
    searchQuery,
    statusFilter,
    progress,
    practiceTab,
  ]);

  const qkdCount = challenges.filter((challenge) => challenge.practiceTrack === 'qkd').length;
  const solvedCount = Object.values(progress).filter((entry) => entry.status === 'solved').length;
  const isQkdTab = practiceTab === 'qkd';

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      <div style={{
        padding: '14px 24px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 1,
        }}>
          {PRACTICE_TABS.map((tab) => (
            <PracticeTabButton
              key={tab.value}
              tab={tab}
              active={practiceTab === tab.value}
              count={tab.value === 'qkd' ? qkdCount : challenges.length}
              onClick={() => setPracticeTab(tab.value)}
            />
          ))}
        </div>
      </div>

      <ProblemFilters />

      <div style={{
        padding: '18px 24px 12px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
      }}>
        <div style={{
          color: colors.text,
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "'Geist Sans', sans-serif",
          marginBottom: 6,
        }}>
          {isQkdTab ? 'QKD Protocol Practice' : 'Quantum Problem Set'}
        </div>
        {isQkdTab && (
          <div style={{
            color: colors.textMuted,
            fontSize: 13,
            fontFamily: "'Geist Sans', sans-serif",
            marginBottom: 10,
            lineHeight: 1.45,
          }}>
            Practice the classical post-processing and security checks behind QKD.
          </div>
        )}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          color: colors.textMuted,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          flexWrap: 'wrap',
        }}>
          <span>{filtered.length} visible problems</span>
          <span>{solvedCount} solved</span>
          <span>{isQkdTab ? 'Browser + desktop Python value contracts' : 'Qiskit-first function contracts'}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock3 size={12} />
            {isQkdTab ? 'Run Visible Tests -> Submit -> Inspect Return Value' : 'Run Visible Tests -> Submit -> Inspect Quantum Output'}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.textDim,
            fontSize: 14,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            No problems match the current filters.
          </div>
        ) : (
          <div style={{ minWidth: 900 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '150px minmax(260px, 2fr) 110px 130px 110px 130px',
              gap: 16,
              padding: '10px 20px',
              borderBottom: `1px solid ${colors.border}`,
              color: colors.textDim,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              background: colors.bgPanel,
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}>
              <span>Status</span>
              <span>Title</span>
              <span>Difficulty</span>
              <span>Category</span>
              <span>Acceptance</span>
              <span>Solved / Best</span>
            </div>

            {filtered.map((challenge) => (
              <ProblemRow
                key={challenge.id}
                challenge={challenge}
                progress={progress[challenge.id]}
                onClick={() => setActiveProblem(challenge)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
