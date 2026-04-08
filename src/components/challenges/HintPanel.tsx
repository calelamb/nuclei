import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { Lightbulb } from 'lucide-react';

interface HintPanelProps {
  hints: string[];
}

export function HintPanel({ hints }: HintPanelProps) {
  const colors = useThemeStore((s) => s.colors);
  const [revealedCount, setRevealedCount] = useState(0);

  if (hints.length === 0) {
    return (
      <span style={{
        color: colors.textDim,
        fontSize: 12,
        fontStyle: 'italic',
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        No hints available for this challenge.
      </span>
    );
  }

  const canRevealMore = revealedCount < hints.length;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Revealed hints */}
      {hints.slice(0, revealedCount).map((hint, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 6,
            background: `${colors.warning}08`,
            border: `1px solid ${colors.warning}20`,
          }}
        >
          <div style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: `${colors.warning}18`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{
              color: colors.warning,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "'Geist Mono', monospace",
            }}>
              {i + 1}
            </span>
          </div>
          <span style={{
            color: colors.textMuted,
            fontSize: 13,
            fontFamily: "'Geist Sans', sans-serif",
            lineHeight: 1.5,
          }}>
            {hint}
          </span>
        </div>
      ))}

      {/* Reveal button */}
      {canRevealMore && (
        <button
          onClick={() => setRevealedCount((c) => c + 1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 6,
            border: `1px solid ${colors.warning}40`,
            background: 'transparent',
            color: colors.warning,
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
            alignSelf: 'flex-start',
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${colors.warning}12`;
            e.currentTarget.style.borderColor = colors.warning;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = `${colors.warning}40`;
          }}
        >
          <Lightbulb size={12} />
          Reveal Hint ({hints.length - revealedCount} remaining)
        </button>
      )}

      {!canRevealMore && (
        <span style={{
          color: colors.textDim,
          fontSize: 11,
          fontStyle: 'italic',
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          All hints revealed.
        </span>
      )}
    </div>
  );
}
