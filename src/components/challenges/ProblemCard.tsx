import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { Check, Clock } from 'lucide-react';
import type { QuantumChallenge, ProblemProgress, ChallengeDifficulty, ChallengeCategory } from '../../types/challenge';

interface ProblemCardProps {
  challenge: QuantumChallenge;
  progress?: ProblemProgress;
  onClick: () => void;
}

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

export function ProblemCard({ challenge, progress, onClick }: ProblemCardProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const [hovered, setHovered] = useState(false);

  const diffColor = DIFFICULTY_COLORS[challenge.difficulty];
  const status = progress?.status ?? 'not_started';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        background: colors.bgElevated,
        border: `1px solid ${hovered ? colors.accent : colors.border}`,
        borderRadius: 10,
        cursor: 'pointer',
        textAlign: 'left',
        boxShadow: hovered ? shadow.md : shadow.sm,
        transition: 'all 180ms ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}
    >
      {/* Top row: status + difficulty */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Status indicator */}
          {status === 'solved' && (
            <div style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: `${colors.success}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Check size={12} color={colors.success} strokeWidth={3} />
            </div>
          )}
          {status === 'attempted' && (
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: colors.warning,
            }} />
          )}
          {status === 'not_started' && (
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: colors.textDim,
              opacity: 0.4,
            }} />
          )}

          {/* Difficulty badge */}
          <span style={{
            padding: '2px 8px',
            borderRadius: 4,
            background: `${diffColor}18`,
            color: diffColor,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            textTransform: 'capitalize',
          }}>
            {challenge.difficulty}
          </span>
        </div>

        {/* Category */}
        <span style={{
          padding: '2px 8px',
          borderRadius: 4,
          background: `${colors.accent}12`,
          color: colors.accent,
          fontSize: 10,
          fontWeight: 500,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          {CATEGORY_LABELS[challenge.category]}
        </span>
      </div>

      {/* Title */}
      <span style={{
        color: colors.text,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: "'Geist Sans', sans-serif",
        lineHeight: 1.3,
      }}>
        {challenge.title}
      </span>

      {/* Bottom row: acceptance rate + estimated time */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 'auto',
      }}>
        <span style={{
          color: colors.textDim,
          fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          {Math.round(challenge.acceptanceRate * 100)}% acceptance
        </span>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: colors.textDim,
        }}>
          <Clock size={11} />
          <span style={{
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            ~{challenge.estimatedMinutes} min
          </span>
        </div>
      </div>

      {/* Best score if attempted */}
      {progress && progress.bestScore > 0 && (
        <div style={{
          padding: '4px 0 0',
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            color: colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            Best: {progress.bestScore}%
          </span>
          <span style={{
            color: colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            {progress.attempts} attempt{progress.attempts !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </button>
  );
}
