import { useThemeStore } from '../../stores/themeStore';
import { useChallengeStore } from '../../stores/challengeStore';
import { useEditorStore } from '../../stores/editorStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { Play, Lightbulb, Trophy } from 'lucide-react';

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: '#10B981',
  intermediate: '#F59E0B',
  advanced: '#EF4444',
};

function formatCountdown(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'Ended';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

export function ChallengeBoard() {
  const colors = useThemeStore((s) => s.colors);
  const challenges = useChallengeStore((s) => s.challenges);
  const activeChallenge = useChallengeStore((s) => s.activeChallenge);
  const leaderboard = useChallengeStore((s) => s.leaderboard);
  const setActiveChallenge = useChallengeStore((s) => s.setActiveChallenge);
  const setCode = useEditorStore((s) => s.setCode);
  const openDirac = useDiracPanelStore((s) => s.open);

  const displayed = activeChallenge ?? challenges[0] ?? null;

  const handleStart = () => {
    if (displayed) {
      setCode(displayed.starterCode);
      setActiveChallenge(displayed);
    }
  };

  const handleHint = () => {
    openDirac();
  };

  if (!displayed) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: colors.textDim,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        No challenges available
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Challenge selector pills */}
      {challenges.length > 1 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
          {challenges.map((ch) => {
            const active = displayed.id === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => setActiveChallenge(ch)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: `1px solid ${active ? colors.accent : colors.border}`,
                  background: active ? `${colors.accent}18` : 'transparent',
                  color: active ? colors.accent : colors.textMuted,
                  fontSize: 10,
                  fontFamily: "'Geist Sans', sans-serif",
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                }}
              >
                W{ch.weekNumber}
              </button>
            );
          })}
        </div>
      )}

      {/* Active challenge card */}
      <div
        style={{
          background: colors.bgElevated,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: colors.text,
              fontFamily: "'Geist Sans', sans-serif",
              flex: 1,
              minWidth: 0,
            }}
          >
            {displayed.title}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              color: '#fff',
              background: DIFFICULTY_COLORS[displayed.difficulty] ?? colors.accent,
              padding: '2px 6px',
              borderRadius: 3,
              textTransform: 'uppercase',
              flexShrink: 0,
            }}
          >
            {displayed.difficulty}
          </span>
        </div>

        <p
          style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: "'Geist Sans', sans-serif",
            lineHeight: 1.5,
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {displayed.description}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontSize: 10,
              color: colors.textDim,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            {formatCountdown(displayed.deadline)}
          </span>
          <span
            style={{
              fontSize: 10,
              color: colors.textDim,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            {displayed.submissions} submissions
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleStart}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              padding: '7px 0',
              borderRadius: 6,
              border: 'none',
              background: colors.accent,
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              cursor: 'pointer',
            }}
          >
            <Play size={12} />
            Start Challenge
          </button>
          <button
            onClick={handleHint}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              padding: '7px 12px',
              borderRadius: 6,
              border: `1px solid ${colors.dirac}40`,
              background: `${colors.dirac}12`,
              color: colors.dirac,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              cursor: 'pointer',
            }}
          >
            <Lightbulb size={12} />
            Ask Dirac
          </button>
        </div>
      </div>

      {/* Leaderboard */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
          }}
        >
          <Trophy size={12} style={{ color: colors.accent }} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: colors.textMuted,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Leaderboard
          </span>
        </div>

        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          <thead>
            <tr>
              {['#', 'Name', 'Score'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Score' ? 'right' : 'left',
                    padding: '4px 6px',
                    color: colors.textDim,
                    fontWeight: 600,
                    fontSize: 9,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry) => (
              <tr key={entry.rank}>
                <td
                  style={{
                    padding: '5px 6px',
                    color: entry.rank <= 3 ? colors.accent : colors.textMuted,
                    fontWeight: entry.rank <= 3 ? 700 : 400,
                    borderBottom: `1px solid ${colors.border}`,
                    width: 28,
                  }}
                >
                  {entry.rank}
                </td>
                <td
                  style={{
                    padding: '5px 6px',
                    color: colors.text,
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  {entry.displayName}
                </td>
                <td
                  style={{
                    padding: '5px 6px',
                    color: colors.textMuted,
                    textAlign: 'right',
                    borderBottom: `1px solid ${colors.border}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {entry.score}
                </td>
              </tr>
            ))}
            {leaderboard.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  style={{
                    padding: 16,
                    textAlign: 'center',
                    color: colors.textDim,
                  }}
                >
                  No entries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
