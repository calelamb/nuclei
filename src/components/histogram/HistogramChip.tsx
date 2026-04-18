import { X, Maximize2 } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

interface HistogramChipProps {
  probabilities: Record<string, number> | null;
  onDismiss?: () => void;
  onExpand?: () => void;
}

const EPSILON = 1e-6;
const MAX_BARS = 3;

/**
 * Compact inline histogram — 2-3 bars showing top outcomes by probability.
 * Lives in the right pane under the Bloch sphere when a run has produced
 * results. Replaces the full-panel `ProbabilityHistogram` in the default
 * layout to reclaim space for the editor + circuit.
 */
export function HistogramChip({ probabilities, onDismiss, onExpand }: HistogramChipProps) {
  const colors = useThemeStore((s) => s.colors);

  if (!probabilities) return null;

  // Secondary sort by state label asc so ties (e.g. Bell state 50/50) render
  // in a stable, readable order regardless of how V8 orders integer-like keys.
  const entries = Object.entries(probabilities)
    .filter(([, p]) => p > EPSILON)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_BARS);

  if (entries.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 10px',
        background: `${colors.accent}0A`,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        fontSize: 11,
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        {entries.map(([state, p]) => (
          <div
            key={state}
            data-testid="histogram-chip-bar"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                color: colors.accentLight,
                flexShrink: 0,
              }}
            >
              |{state}⟩
            </span>
            <div
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: `${colors.accent}14`,
                overflow: 'hidden',
                minWidth: 20,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(p * 100)}%`,
                  background: colors.accent,
                  transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>
            <span style={{ color: colors.textDim, width: 28, textAlign: 'right', flexShrink: 0 }}>
              {Math.round(p * 100)}%
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {onExpand && (
          <button
            aria-label="Expand histogram"
            onClick={onExpand}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textDim,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          >
            <Maximize2 size={12} />
          </button>
        )}
        {onDismiss && (
          <button
            aria-label="Dismiss histogram"
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textDim,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.error; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
