import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useThemeStore } from '../../stores/themeStore';
import { getMultiSeriesHistogramData, type HistogramSeriesInput } from './histogramData';

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
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        Select runs to compare their measurements.
      </div>
    );
  }

  const data = getMultiSeriesHistogramData(series);

  if (data.length === 0) {
    return (
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        No measurements recorded for the selected runs.
      </div>
    );
  }

  return (
    <div style={{ height: 260, display: 'flex', flexDirection: 'column' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
          <XAxis
            dataKey="state"
            tick={{ fill: colors.text, fontSize: 11, fontFamily: "'Fira Code', monospace" }}
            axisLine={{ stroke: colors.border }}
            tickLine={{ stroke: colors.border }}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fill: colors.textDim, fontSize: 11, fontFamily: "'Fira Code', monospace" }}
            axisLine={{ stroke: colors.border }}
            tickLine={{ stroke: colors.border }}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              background: colors.bgPanel,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "'Fira Code', monospace",
            }}
            labelStyle={{ color: colors.text }}
            formatter={(value) => [typeof value === 'number' ? value.toFixed(4) : String(value ?? ''), 'Probability']}
          />
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }} />
          {series.map((s) => (
            <Bar key={s.label} dataKey={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
