import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { ProblemBrowser } from './ProblemBrowser';
import { ProblemWorkspace } from './ProblemWorkspace';
import { ChevronLeft, Trophy } from 'lucide-react';

export function ChallengeModeView() {
  const colors = useThemeStore((s) => s.colors);
  const activeProblem = useChallengeModeStore((s) => s.activeProblem);
  const setActiveProblem = useChallengeModeStore((s) => s.setActiveProblem);
  const exitChallengeMode = useChallengeModeStore((s) => s.exitChallengeMode);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: colors.bg,
      overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
      }}>
        {activeProblem ? (
          <button
            onClick={() => setActiveProblem(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'transparent',
              border: 'none',
              color: colors.textMuted,
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
              padding: '4px 8px',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.text;
              e.currentTarget.style.background = colors.bgElevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textMuted;
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <ChevronLeft size={14} />
            Back
          </button>
        ) : (
          <button
            onClick={exitChallengeMode}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'transparent',
              border: 'none',
              color: colors.textMuted,
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
              padding: '4px 8px',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.text;
              e.currentTarget.style.background = colors.bgElevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textMuted;
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <ChevronLeft size={14} />
            Exit
          </button>
        )}

        <div style={{ width: 1, height: 16, background: colors.border }} />

        <Trophy size={15} color={colors.accent} />
        <span style={{
          color: colors.text,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          Quantum Challenges
        </span>

        {activeProblem && (
          <>
            <div style={{ width: 1, height: 16, background: colors.border }} />
            <span style={{
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {activeProblem.title}
            </span>
          </>
        )}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeProblem
          ? <ProblemWorkspace />
          : <ProblemBrowser />
        }
      </div>
    </div>
  );
}
