import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useThemeStore } from '../../stores/themeStore';
import { formatProbabilityTick, getMultiSeriesHistogramData, PROBABILITY_TICKS, type HistogramSeriesInput } from './histogramData';
import { hasMeasurements, tooltipOrder } from './multiSeriesHelpers';

import { TYPOGRAPHY } from '../../styles/tokens';
export interface MultiSeriesHistogramSeries extends HistogramSeriesInput {
  color: string;
}

/**
 * PRD 09 Phase E (E1) — overlaid/grouped histogram for the Compare view: 2+
 * labelled runs' measurement distributions, one grouped bar per run at each
 * observed state, with a legend. Deliberately a NEW component rather than a
 * mode added to `ProbabilityHistogram`/`RunHistogram` (both are
 * single-result by contract — see `RunHistogram`'s own doc comment); it
 * consumes the additive `getMultiSeriesHistogramData` transform so the
 * single-series callers stay untouched.
 */
export function MultiSeriesHistogram({ series }: { series: MultiSeriesHistogramSeries[] }) {
  const colors = useThemeStore((s) => s.colors);

  if (series.length === 0) {
    return (
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        Select runs to compare their measurements.
      </div>
    );
  }

  // A run with no measurements has nothing to plot: it stays in the legend (flagged by its
  // label) but gets no bar and no tooltip row, so the tooltip never invents a 0.0000.
  const plotted = series.filter(hasMeasurements);
  const data = getMultiSeriesHistogramData(plotted);

  if (data.length === 0) {
    return (
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        No measurements recorded for the selected runs.
      </div>
    );
  }

  return (
    <div style={{ height: 260, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200} initialDimension={{ width: 480, height: 220 }}>
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
            cursor={{ fill: colors.bgElevated }}
            contentStyle={{
              background: colors.bgElevated,
              border: `1px solid ${colors.borderStrong}`,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: TYPOGRAPHY.fontMono,
            }}
            labelStyle={{ color: colors.text }}
            separator=": "
            itemSorter={(item) => tooltipOrder(plotted, item.dataKey)}
            formatter={(value, name) => [typeof value === 'number' ? value.toFixed(4) : String(value ?? ''), String(name ?? '')]}
          />
          {plotted.map((s) => (
            <Bar key={s.label} dataKey={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      </div>
      {/* Own legend (series order) — recharts reverses grouped-bar legend order. */}
      <ul style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 14px', margin: '4px 0 0', padding: 0, listStyle: 'none', fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, color: colors.textMuted }}>
        {series.map((s) => (
          <li key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
