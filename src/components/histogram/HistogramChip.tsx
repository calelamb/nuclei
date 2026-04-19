import { X, Maximize2 } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

interface HistogramChipProps {
  probabilities: Record<string, number> | null;
  /**
   * Optional hardware-run probabilities. When present the chip renders two
   * stacked bars per outcome: classical (simulator) in the accent color,
   * hardware in the Dirac purple. Makes the "real quantum hardware matches
   * the simulator — mostly" teaching moment visible at a glance.
   */
  hwProbabilities?: Record<string, number> | null;
  hwLabel?: string;
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
export function HistogramChip({
  probabilities,
  hwProbabilities,
  hwLabel,
  onDismiss,
  onExpand,
}: HistogramChipProps) {
  const colors = useThemeStore((s) => s.colors);

  if (!probabilities) return null;

  // Union of classical + hardware outcomes — we want every state that either
  // side saw. Rank by max(p_classical, p_hardware) so the top-3 are the
  // outcomes that actually matter regardless of which side produced them.
  const merged: Record<string, { cls: number; hw: number; max: number }> = {};
  for (const [s, p] of Object.entries(probabilities)) {
    if (p > EPSILON) merged[s] = { cls: p, hw: 0, max: p };
  }
  if (hwProbabilities) {
    for (const [s, p] of Object.entries(hwProbabilities)) {
      if (p <= EPSILON) continue;
      const prev = merged[s] ?? { cls: 0, hw: 0, max: 0 };
      merged[s] = { cls: prev.cls, hw: p, max: Math.max(prev.max, p) };
    }
  }
  const entries = Object.entries(merged)
    .sort((a, b) => b[1].max - a[1].max || a[0].localeCompare(b[0]))
    .slice(0, MAX_BARS);

  if (entries.length === 0) return null;

  const hasHw = !!hwProbabilities;

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {entries.map(([state, { cls, hw }]) => (
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
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 20,
              }}
            >
              <div
                style={{
                  height: hasHw ? 4 : 6,
                  borderRadius: 3,
                  background: `${colors.accent}14`,
                  overflow: 'hidden',
                }}
                title="Classical simulation"
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round(cls * 100)}%`,
                    background: colors.accent,
                    transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              </div>
              {hasHw && (
                <div
                  style={{
                    height: 4,
                    borderRadius: 3,
                    background: `${colors.dirac}14`,
                    overflow: 'hidden',
                  }}
                  title={hwLabel ?? 'Hardware run'}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round(hw * 100)}%`,
                      background: colors.dirac,
                      transition: 'width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
              )}
            </div>
            <span
              style={{
                color: colors.textDim,
                minWidth: hasHw ? 54 : 28,
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {hasHw
                ? `${Math.round(cls * 100)}% · ${Math.round(hw * 100)}%`
                : `${Math.round(cls * 100)}%`}
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
