import { useState, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useSimulationStore } from '../../stores/simulationStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useDebugStore } from '../../stores/debugStore';
import { activeDebugStep } from '../../lib/debugTrace';
import { getHistogramData, getProbabilityHistogramData, type HistogramViewMode } from './histogramData';
import { formatPercentTick, probabilityAxis, topOutcomes, MAX_VISIBLE_OUTCOMES, type HistogramRow } from './histogramScale';

import { TYPOGRAPHY } from '../../styles/tokens';
import { useThemeStore } from '../../stores/themeStore';
import { Button, TextInput } from '../ui';
const MANY_BARS = 8;
const SCROLL_BAR_SLOT_PX = 30;

/**
 * The recharts bar chart, shared by the run view and the debugger step view.
 * The y axis fits the data (so a 64-outcome uniform run is not a flat line),
 * ticks are whole percents, and labels tilt when there are many bars. In
 * `scroll` mode every outcome keeps a readable slot and the chart scrolls.
 */
function HistogramChart({ data, srDescription, scroll = false }: { data: HistogramRow[]; srDescription: string; scroll?: boolean }) {
  const colors = useThemeStore((s) => s.colors);
  const axis = probabilityAxis(Math.max(0, ...data.map((d) => d.probability)));
  const crowded = data.length > MANY_BARS;
  return (
    <div
      style={{ flex: 1, minHeight: 0, overflowX: scroll ? 'auto' : 'hidden', overflowY: 'hidden' }}
      role="region"
      aria-label="Probability histogram"
      aria-description={srDescription}
      tabIndex={scroll ? 0 : undefined}
    >
      <div style={{ height: '100%', minWidth: scroll ? data.length * SCROLL_BAR_SLOT_PX + 56 : undefined }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, bottom: crowded ? 8 : 0, left: 0 }}>
            <XAxis
              dataKey="state"
              interval={scroll ? 0 : 'preserveStartEnd'}
              angle={crowded ? -45 : 0}
              textAnchor={crowded ? 'end' : 'middle'}
              height={crowded ? 54 : 26}
              tick={{ fill: colors.text, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
              axisLine={{ stroke: colors.borderStrong }}
              tickLine={{ stroke: colors.borderStrong }}
            />
            <YAxis
              domain={[0, axis.max]}
              ticks={axis.ticks}
              width={44}
              tick={{ fill: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
              axisLine={{ stroke: colors.borderStrong }}
              tickLine={{ stroke: colors.borderStrong }}
              tickFormatter={formatPercentTick}
            />
            <Tooltip
              cursor={{ fill: colors.bgElevated }}
              contentStyle={{ background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, borderRadius: 6, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono }}
              labelStyle={{ color: colors.text }}
              itemStyle={{ color: colors.accent }}
              formatter={(value) => [typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : String(value ?? ''), 'Probability']}
            />
            <Bar dataKey="probability" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((_, index) => (
                <Cell key={index} fill={colors.accent} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** "Showing the 16 most likely of 64 outcomes" with a switch to see them all. */
function OutcomeCap({ shown, hiddenCount, hiddenProbability, showAll, onToggle }: {
  shown: number; hiddenCount: number; hiddenProbability: number; showAll: boolean; onToggle: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  if (hiddenCount === 0 && !showAll) return <div style={{ flex: 1 }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={showAll ? undefined : `${hiddenCount} other outcomes hold ${formatPercentTick(hiddenProbability)} of shots`}>
        {showAll
          ? 'Every outcome shown. Scroll sideways.'
          : `Top ${shown} outcomes. ${hiddenCount} others hold ${formatPercentTick(hiddenProbability)} of shots.`}
      </span>
      <Button size="sm" variant="ghost" onClick={onToggle} style={{ flexShrink: 0 }}>{showAll ? 'Show top outcomes' : 'Show all'}</Button>
    </div>
  );
}

export function ProbabilityHistogram() {
  const colors = useThemeStore((s) => s.colors);
  const result = useSimulationStore((s) => s.result);
  const shots = useSimulationStore((s) => s.shots);
  const setShots = useSimulationStore((s) => s.setShots);
  const [viewMode, setViewMode] = useState<HistogramViewMode>('sampled');
  const [showAll, setShowAll] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // Quantum Debugger (Phase 3): while stepping, show the ideal probabilities AT
  // the cursor from the cached trace (per-step payloads have no sampled counts).
  const stepMode = useCircuitStore((s) => s.stepMode);
  const stepIndex = useCircuitStore((s) => s.stepIndex);
  const trace = useDebugStore((s) => s.trace);
  const step = stepMode ? activeDebugStep(trace, stepIndex) : null;

  const handleShotsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 100 && val <= 100000) {
      setShots(val);
    }
  }, [setShots]);

  if (step) {
    const stepRows = getProbabilityHistogramData(step.probabilities);
    const stepView = topOutcomes(stepRows, showAll ? Infinity : MAX_VISIBLE_OUTCOMES);
    const data = stepView.shown;
    const srDescription = stepRows.map((d) => `${d.state}: ${(d.probability * 100).toFixed(1)}% probability`).join(', ');
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
          <span style={{ color: colors.accent, fontSize: 11, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans }}>
            Ideal probabilities · state at {step.gate_index < 0 ? 'start' : `${step.label}`}
          </span>
          <OutcomeCap shown={data.length} hiddenCount={stepView.hiddenCount} hiddenProbability={stepView.hiddenProbability} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />
        </div>
        <HistogramChart data={data} srDescription={srDescription} scroll={showAll && stepRows.length > MAX_VISIBLE_OUTCOMES} />
      </div>
    );
  }

  if (!result) {
    return (
      <div style={{
        height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 10,
      }}>
        {/* Ghost histogram bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, opacity: 0.12 }}>
          {[28, 42, 18, 36].map((h, i) => (
            <div key={i} style={{
              width: 16, height: h, background: colors.wire,
              borderRadius: '3px 3px 0 0',
            }} />
          ))}
        </div>
        <span style={{ color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
          Run a simulation to see results
        </span>
      </div>
    );
  }

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
        {/* View mode toggle */}
        <div style={{
          display: 'flex',
          borderRadius: 4,
          overflow: 'hidden',
          border: `1px solid ${colors.borderStrong}`,
        }}>
          {(['sampled', 'ideal'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontFamily: TYPOGRAPHY.fontSans,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === mode ? colors.accent : colors.bgElevated,
                color: viewMode === mode ? colors.bgPanel : colors.textMuted,
                fontWeight: viewMode === mode ? 600 : 400,
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Shots control */}
        <label style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, display: 'flex', alignItems: 'center', gap: 6 }}>
          Shots:
          <TextInput
            type="number"
            size="sm"
            mono
            value={shots}
            onChange={handleShotsChange}
            min={100}
            max={100000}
            step={100}
            aria-label="Shots"
            style={{ width: 80 }}
          />
        </label>

        <OutcomeCap shown={data.length} hiddenCount={view.hiddenCount} hiddenProbability={view.hiddenProbability} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />

        {/* Export */}
        <Button size="sm" onClick={handleExportCSV}>
          Export CSV
        </Button>

        {/* Execution time */}
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}>
          {result.execution_time_ms.toFixed(0)}ms
        </span>
      </div>

      {/* Chart */}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <HistogramChart data={data} srDescription={srDescription} scroll={showAll && allRows.length > MAX_VISIBLE_OUTCOMES} />
      </div>
    </div>
  );
}
