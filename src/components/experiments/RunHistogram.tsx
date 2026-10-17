import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useThemeStore } from '../../stores/themeStore';
import { formatProbabilityTick, getHistogramData, PROBABILITY_TICKS } from '../histogram/histogramData';
import type { SimulationResult } from '../../types/quantum';
import { TYPOGRAPHY } from '../../styles/tokens';

/**
 * PRD 09 Phase D (D3) — histogram of a historical run's `measurements`.
 *
 * `ProbabilityHistogram` (the Learn/Code-mode histogram) is hard-wired to
 * the live `simulationStore` (shots slider writes into it, a CSV button
 * reads the live result) — reusing it as-is here would either corrupt that
 * global state or require threading an override prop through a component
 * that Learn mode must keep byte-identical. Instead this reuses the actual
 * reusable unit underneath it: `getHistogramData` from `histogramData.ts`,
 * the pure probability-from-counts transform, wrapped in a small read-only
 * chart that matches the app's token-driven visual style.
 */
export function RunHistogram({ measurements }: { measurements: Record<string, number> }) {
  const colors = useThemeStore((s) => s.colors);
  const shotCount = Object.values(measurements).reduce((a, b) => a + b, 0);

  if (shotCount === 0) {
    return (
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        No measurements recorded for this run.
      </div>
    );
  }

  // Minimal SimulationResult shape — only the fields getHistogramData reads
  // (measurements, probabilities, shot_count) need to be real.
  const asResult: SimulationResult = {
    state_vector: [],
    probabilities: {},
    measurements,
    bloch_coords: [],
    execution_time_ms: 0,
    shot_count: shotCount,
    metrics: {},
  };
  const data = getHistogramData(asResult, 'sampled');

  return (
    <div style={{ height: 220, display: 'flex', flexDirection: 'column' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
          <XAxis
            dataKey="state"
            tick={{ fill: colors.text, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
            axisLine={{ stroke: colors.border }}
            tickLine={{ stroke: colors.border }}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fill: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
            axisLine={{ stroke: colors.border }}
            tickLine={{ stroke: colors.border }}
            ticks={[...PROBABILITY_TICKS]}
            tickFormatter={formatProbabilityTick}
          />
          <Tooltip
            contentStyle={{
              background: colors.bgPanel,
              border: `1px solid ${colors.border}`,
              borderRadius: 'var(--radius-soft)',
              fontSize: 12,
              fontFamily: TYPOGRAPHY.fontMono,
            }}
            labelStyle={{ color: colors.text }}
            itemStyle={{ color: colors.accentText }}
            formatter={(value) => [typeof value === 'number' ? value.toFixed(4) : String(value ?? ''), 'Probability']}
          />
          <Bar dataKey="probability" radius={[4, 4, 0, 0]}>
            {data.map((_, index) => (
              <Cell key={index} fill={colors.accent} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
