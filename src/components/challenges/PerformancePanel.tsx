import { Star, Zap } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { EfficiencyMetricReport, EfficiencyReport, EfficiencyTier } from '../../types/challenge';

interface PerformancePanelProps {
  report: EfficiencyReport;
}

const TIER_LABEL: Record<EfficiencyTier, string> = {
  optimal: 'Optimal',
  efficient: 'Efficient',
  accepted: 'Accepted',
};

function tierColor(
  tier: EfficiencyTier,
  colors: { success: string; accent: string; textMuted: string },
): string {
  if (tier === 'optimal') return colors.success;
  if (tier === 'efficient') return colors.accent;
  return colors.textMuted;
}

/** How full the meter reads: at/under par → full; far over → empty. */
function fillRatio(value: number, optimal: number): number {
  if (optimal === 0) return value === 0 ? 1 : 0.15;
  if (value === 0) return 1;
  return Math.max(0.06, Math.min(1, optimal / value));
}

function MetricBar({ ratio, color, track }: { ratio: number; color: string; track: string }) {
  return (
    <div style={{ width: 96, height: 6, borderRadius: 3, background: track, overflow: 'hidden' }}>
      <div style={{ width: `${ratio * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
    </div>
  );
}

function PrimaryMetricRow({ metric }: { metric: EfficiencyMetricReport }) {
  const colors = useThemeStore((s) => s.colors);
  const hasTarget = metric.optimal !== undefined;
  const color = hasTarget ? tierColor(metric.tier, colors) : colors.textMuted;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <span style={{
        width: 108,
        color: colors.textMuted,
        fontSize: 12,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        {metric.label}
      </span>
      <span style={{
        width: 34,
        textAlign: 'right',
        color: colors.text,
        fontSize: 13,
        fontWeight: 700,
        fontFamily: "'Geist Mono', monospace",
      }}>
        {metric.value}
      </span>
      {hasTarget ? (
        <>
          <MetricBar ratio={fillRatio(metric.value, metric.optimal!)} color={color} track={`${colors.textDim}22`} />
          <span style={{
            color: colors.textDim,
            fontSize: 10,
            fontFamily: "'Geist Mono', monospace",
            width: 58,
          }}>
            opt {metric.optimal}
          </span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color,
            fontSize: 10.5,
            fontWeight: 700,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            {metric.tier === 'optimal' && <Star size={10} fill={color} strokeWidth={0} />}
            {TIER_LABEL[metric.tier]}
          </span>
        </>
      ) : (
        <span style={{
          color: colors.textDim,
          fontSize: 10.5,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          measured
        </span>
      )}
    </div>
  );
}

export function PerformancePanel({ report }: PerformancePanelProps) {
  const colors = useThemeStore((s) => s.colors);
  const primary = report.reports.filter((metric) => metric.primary);
  const secondary = report.reports.filter((metric) => !metric.primary);
  const execMs = report.metrics.executionTimeMs;

  const accent = report.isOptimal ? colors.success : colors.accent;

  return (
    <div style={{
      margin: '6px 12px 10px',
      border: `1px solid ${report.isOptimal ? `${colors.success}55` : colors.border}`,
      borderRadius: 10,
      background: report.isOptimal ? `${colors.success}0c` : colors.bgPanel,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 12px',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <Zap size={13} color={accent} fill={accent} />
        <span style={{
          color: colors.text,
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "'Geist Sans', sans-serif",
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          Performance
        </span>
        {report.hasTarget && report.isOptimal && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 'auto',
            padding: '2px 8px',
            borderRadius: 999,
            background: `${colors.success}20`,
            color: colors.success,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            <Star size={11} fill={colors.success} strokeWidth={0} />
            Optimal solution
          </span>
        )}
        {report.hasTarget && !report.isOptimal && (
          <span style={{
            marginLeft: 'auto',
            color: colors.textMuted,
            fontSize: 10.5,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            Hit every optimal target for the ★
          </span>
        )}
        {!report.hasTarget && (
          <span style={{
            marginLeft: 'auto',
            color: colors.textDim,
            fontSize: 10.5,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            No efficiency par for this problem yet
          </span>
        )}
      </div>

      {/* Primary metrics */}
      <div style={{ padding: '6px 12px' }}>
        {primary.map((metric) => (
          <PrimaryMetricRow key={metric.key} metric={metric} />
        ))}

        {/* Secondary metrics — compact */}
        <div style={{
          marginTop: 6,
          paddingTop: 8,
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          color: colors.textDim,
          fontSize: 11,
          fontFamily: "'Geist Mono', monospace",
        }}>
          {secondary.map((metric) => (
            <span key={metric.key}>
              {metric.label}: <span style={{ color: colors.textMuted, fontWeight: 600 }}>{metric.value}</span>
              {metric.optimal !== undefined ? <span style={{ color: colors.textDim }}> / {metric.optimal}</span> : null}
            </span>
          ))}
          {typeof execMs === 'number' && execMs > 0 && (
            <span>
              time: <span style={{ color: colors.textMuted, fontWeight: 600 }}>
                {execMs < 1000 ? `${Math.round(execMs)}ms` : `${(execMs / 1000).toFixed(1)}s`}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
