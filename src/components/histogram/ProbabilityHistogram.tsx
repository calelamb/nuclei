import { useState, useRef, type ReactNode } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { useElementSize } from '../../hooks/useElementSize';
import { useSimulationStore } from '../../stores/simulationStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useDebugStore } from '../../stores/debugStore';
import { activeDebugStep } from '../../lib/debugTrace';
import { getHistogramData, getProbabilityHistogramData, type HistogramViewMode } from './histogramData';
import { formatPercentTick, probabilityAxis, topOutcomes, MAX_VISIBLE_OUTCOMES, type HistogramRow } from './histogramScale';

import { useScrollbarInset } from '../../hooks/useScrollbarInset';
import { TYPOGRAPHY } from '../../styles/tokens';
import { useThemeStore } from '../../stores/themeStore';
import { ResultsEmptyState } from '../bloch/ResultsEmptyState';
import { ShotsField } from './ShotsField';
import { Button, SegmentedControl, type SegmentedOption } from '../ui';
import './histogram.css';
const VIEW_OPTIONS: ReadonlyArray<SegmentedOption<HistogramViewMode>> = [
  { value: 'sampled', label: 'Sampled' },
  { value: 'ideal', label: 'Ideal' },
];
const MANY_BARS = 8;
/** Two outcomes in a wide slab are not 300px bars: cap them and centre in their slot. */
const MAX_BAR_WIDTH_PX = 56;
/** Rotated outcome labels reach this far left of their tick, so the first one needs room. */
const CROWDED_LEFT_MARGIN_PX = 44;
const SCROLL_BAR_SLOT_PX = 30;

const Y_AXIS_WIDTH = 44;
const CHART_MARGIN_RIGHT = 10;

interface ChartProps {
  data: HistogramRow[];
  srDescription: string;
  scroll?: boolean;
}

interface PinnedYAxisProps {
  ticks: readonly number[];
  max: number;
  /** Plot-area offsets that match the scrolling chart's margins and x axis. */
  top: number;
  bottom: number;
}

/** The y axis for the scrolling chart: plain DOM, so it never scrolls away with the bars. */
function PinnedYAxis({ ticks, max, top, bottom }: PinnedYAxisProps) {
  return (
    <div className="histogram-scroll__axis" data-testid="histogram-yaxis" aria-hidden="true" style={{ width: Y_AXIS_WIDTH, paddingTop: top, paddingBottom: bottom }}>
      <div className="histogram-scroll__plot">
        {ticks.map((tick) => (
          <span key={tick} className="histogram-scroll__tick" style={{ bottom: `${max > 0 ? (tick / max) * 100 : 0}%` }}>
            {formatPercentTick(tick)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Measures its own box and renders the chart only once that box has a real size, so recharts
 * never sees a zero or negative width (it warns, and draws nothing useful, when it does).
 */
function SizedBox({ children }: { children: (width: number, height: number) => ReactNode }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {size.width > 0 && size.height > 0 ? children(size.width, size.height) : null}
    </div>
  );
}

/**
 * The recharts bar chart, shared by the run view and the debugger step view.
 * The y axis fits the data (so a 64-outcome uniform run is not a flat line),
 * ticks are whole percents, and labels tilt when there are many bars. In
 * `scroll` mode every outcome keeps a readable slot and the bars scroll while
 * the y axis stays pinned in its own column.
 */
function HistogramChart({ data, srDescription, scroll = false }: ChartProps) {
  const colors = useThemeStore((s) => s.colors);
  const axis = probabilityAxis(Math.max(0, ...data.map((d) => d.probability)));
  const crowded = data.length > MANY_BARS;
  const xAxisHeight = crowded ? 54 : 26;
  const margin = { top: 5, right: CHART_MARGIN_RIGHT, bottom: crowded ? 8 : 0, left: 0 };
  const axisStroke = { stroke: colors.borderStrong };
  const [barsRef, scrollbarInset] = useScrollbarInset<HTMLDivElement>();

  const yAxis = (visible: boolean) => (
    <YAxis
      hide={!visible}
      domain={[0, axis.max]}
      ticks={axis.ticks}
      width={visible ? Y_AXIS_WIDTH : 0}
      tick={{ fill: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
      axisLine={axisStroke}
      tickLine={axisStroke}
      tickFormatter={formatPercentTick}
    />
  );

  const scrollMargin = { ...margin, left: crowded ? CROWDED_LEFT_MARGIN_PX : 16, right: 16 };
  const renderBars = (width: number, height: number) => (
      <BarChart width={width} height={height} data={data} margin={scroll ? scrollMargin : margin}>
        <XAxis
          dataKey="state"
          interval={scroll ? 0 : 'preserveStartEnd'}
          angle={crowded ? -45 : 0}
          textAnchor={crowded ? 'end' : 'middle'}
          height={xAxisHeight}
          tick={{ fill: colors.text, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
          axisLine={axisStroke}
          tickLine={axisStroke}
        />
        {yAxis(!scroll)}
        <Tooltip
          cursor={{ fill: colors.bgElevated }}
          contentStyle={{ background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, borderRadius: 6, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono }}
          labelStyle={{ color: colors.text }}
          separator=": "
          itemStyle={{ color: colors.accentText }}
          formatter={(value) => [typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : String(value ?? ''), 'Probability']}
        />
        <Bar dataKey="probability" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_WIDTH_PX} isAnimationActive={false}>
          {data.map((_, index) => (
            <Cell key={index} fill={colors.accent} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
  );

  if (!scroll) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} role="region" aria-label="Probability histogram" aria-description={srDescription}>
        <SizedBox>{renderBars}</SizedBox>
      </div>
    );
  }

  return (
    <div className="histogram-scroll" role="region" aria-label="Probability histogram" aria-description={srDescription}>
      <PinnedYAxis ticks={axis.ticks} max={axis.max} top={margin.top} bottom={xAxisHeight + margin.bottom + scrollbarInset} />
      <div ref={barsRef} className="histogram-scroll__bars" tabIndex={0} aria-label="Scrollable outcome bars">
        <div style={{ height: '100%', minWidth: data.length * SCROLL_BAR_SLOT_PX + scrollMargin.left + scrollMargin.right }}><SizedBox>{renderBars}</SizedBox></div>
      </div>
    </div>
  );
}

/** "Showing the 16 most likely of 64 outcomes" with a switch to see them all. */
function OutcomeCap({ shown, hiddenCount, hiddenProbability, evenlySpread, showAll, onToggle }: {
  shown: number; hiddenCount: number; hiddenProbability: number; evenlySpread: boolean; showAll: boolean; onToggle: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  if (hiddenCount === 0 && !showAll) return <div style={{ flex: 1 }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={showAll ? undefined : `${hiddenCount} other outcomes hold ${formatPercentTick(hiddenProbability)} of shots`}>
        {showAll
          ? 'Every outcome shown. Scroll sideways.'
          : evenlySpread
            ? `${shown + hiddenCount} outcomes, all about equally likely. Showing ${shown}.`
            : `Top ${shown} outcomes. ${hiddenCount} others hold ${formatPercentTick(hiddenProbability)} of shots.`}
      </span>
      <Button size="sm" variant="ghost" onClick={onToggle} style={{ flexShrink: 0 }}>{showAll ? 'Show top outcomes' : 'Show all'}</Button>
    </div>
  );
}

export function ProbabilityHistogram() {
  const colors = useThemeStore((s) => s.colors);
  const result = useSimulationStore((s) => s.result);
  const [viewMode, setViewMode] = useState<HistogramViewMode>('sampled');
  const [showAll, setShowAll] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // Quantum Debugger (Phase 3): while stepping, show the ideal probabilities AT
  // the cursor from the cached trace (per-step payloads have no sampled counts).
  const stepMode = useCircuitStore((s) => s.stepMode);
  const stepIndex = useCircuitStore((s) => s.stepIndex);
  const trace = useDebugStore((s) => s.trace);
  const step = stepMode ? activeDebugStep(trace, stepIndex) : null;

  if (step) {
    const stepRows = getProbabilityHistogramData(step.probabilities);
    const stepView = topOutcomes(stepRows, showAll ? Infinity : MAX_VISIBLE_OUTCOMES);
    const data = stepView.shown;
    const srDescription = stepRows.map((d) => `${d.state}: ${(d.probability * 100).toFixed(1)}% probability`).join(', ');
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
          <span style={{ color: colors.accentText, fontSize: 11, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans }}>
            Ideal probabilities · state at {step.gate_index < 0 ? 'start' : `${step.label}`}
          </span>
          <OutcomeCap shown={data.length} hiddenCount={stepView.hiddenCount} hiddenProbability={stepView.hiddenProbability} evenlySpread={stepView.evenlySpread} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />
        </div>
        <HistogramChart data={data} srDescription={srDescription} scroll={showAll && stepRows.length > MAX_VISIBLE_OUTCOMES} />
      </div>
    );
  }

  // The same empty state the rest of the results zone shows: it says Running… during a run, not "run a simulation".
  if (!result) return <ResultsEmptyState />;

  const allRows = getHistogramData(result, viewMode);
  const view = topOutcomes(allRows, showAll ? Infinity : MAX_VISIBLE_OUTCOMES);
  const data = view.shown;

  const handleExportCSV = () => {
    const header = 'State,Probability\n';
    const rows = allRows.map(d => `${d.state},${d.probability.toFixed(6)}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nuclei_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Screen reader description
  const srDescription = allRows.map(d => `${d.state}: ${(d.probability * 100).toFixed(1)}% probability`).join(', ');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px' }}>
      {/* Controls bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 8,
        flexShrink: 0,
      }}>
        <SegmentedControl
          aria-label="Histogram view"
          value={viewMode}
          onChange={setViewMode}
          options={VIEW_OPTIONS}
        />

        <ShotsField />

        <OutcomeCap shown={data.length} hiddenCount={view.hiddenCount} hiddenProbability={view.hiddenProbability} evenlySpread={view.evenlySpread} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />

        {/* Export */}
        <Button size="sm" onClick={handleExportCSV}>
          Export CSV
        </Button>

        {/* Execution time */}
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}>
          Ran in {result.execution_time_ms.toFixed(0)} ms
        </span>
      </div>

      {/* Chart */}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <HistogramChart data={data} srDescription={srDescription} scroll={showAll && allRows.length > MAX_VISIBLE_OUTCOMES} />
      </div>
    </div>
  );
}
