import { useEffect, useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { QUANTUM_CHALLENGES } from '../../data/challenges';
import { ProblemFilters } from './ProblemFilters';
import { ProblemCard } from './ProblemCard';

export function ProblemBrowser() {
  const colors = useThemeStore((s) => s.colors);
  const setChallenges = useChallengeModeStore((s) => s.setChallenges);
  const challenges = useChallengeModeStore((s) => s.challenges);
  const difficultyFilter = useChallengeModeStore((s) => s.difficultyFilter);
  const categoryFilter = useChallengeModeStore((s) => s.categoryFilter);
  const searchQuery = useChallengeModeStore((s) => s.searchQuery);
  const statusFilter = useChallengeModeStore((s) => s.statusFilter);
  const progress = useChallengeModeStore((s) => s.progress);
  const setActiveProblem = useChallengeModeStore((s) => s.setActiveProblem);

  useEffect(() => {
    if (challenges.length === 0) {
      setChallenges(QUANTUM_CHALLENGES);
    }
  }, [challenges.length, setChallenges]);

  // Compute filtered inline so Zustand re-renders on any filter/data change
  const filtered = useMemo(() => {
    return challenges.filter((c) => {
      if (difficultyFilter && c.difficulty !== difficultyFilter) return false;
      if (categoryFilter && c.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!c.title.toLowerCase().includes(q) && !c.tags.some((t) => t.toLowerCase().includes(q))) return false;
      }
      if (statusFilter !== 'all') {
        const p = progress[c.id];
        const status = p ? p.status : 'not_started';
        if (status !== statusFilter) return false;
      }
      return true;
    });
  }, [challenges, difficultyFilter, categoryFilter, searchQuery, statusFilter, progress]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <ProblemFilters />

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px 48px',
      }}>
        {filtered.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 0',
          }}>
            <span style={{
              color: colors.textDim,
              fontSize: 14,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              No challenges match your filters.
            </span>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
            maxWidth: 1200,
            margin: '0 auto',
          }}>
            {filtered.map((challenge) => (
              <ProblemCard
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
