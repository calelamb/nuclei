import { useState, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useSimulationStore } from '../../stores/simulationStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useDebugStore } from '../../stores/debugStore';
import { activeDebugStep } from '../../lib/debugTrace';
import { getHistogramData, getProbabilityHistogramData, type HistogramViewMode } from './histogramData';

import { TYPOGRAPHY } from '../../styles/tokens';
import { useThemeStore } from '../../stores/themeStore';
import { Button, TextInput } from '../ui';
type HistogramRow = { state: string; probability: number };

/** The recharts bar chart, shared by the run view and the debugger step view. */
function HistogramChart({ data, srDescription }: { data: HistogramRow[]; srDescription: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ flex: 1, minHeight: 0 }} role="region" aria-label="Probability histogram" aria-description={srDescription}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
          <XAxis
            dataKey="state"
            tick={{ fill: colors.text, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
            axisLine={{ stroke: colors.borderStrong }}
            tickLine={{ stroke: colors.borderStrong }}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fill: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}
            axisLine={{ stroke: colors.borderStrong }}
            tickLine={{ stroke: colors.borderStrong }}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{ background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, borderRadius: 6, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono }}
            labelStyle={{ color: colors.text }}
            itemStyle={{ color: colors.accent }}
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

export function ProbabilityHistogram() {
  const colors = useThemeStore((s) => s.colors);
  const result = useSimulationStore((s) => s.result);
  const shots = useSimulationStore((s) => s.shots);
  const setShots = useSimulationStore((s) => s.setShots);
  const [viewMode, setViewMode] = useState<HistogramViewMode>('sampled');
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
    const data = getProbabilityHistogramData(step.probabilities);
    const srDescription = data.map((d) => `${d.state}: ${(d.probability * 100).toFixed(1)}% probability`).join(', ');
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
          <span style={{ color: colors.accent, fontSize: 11, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans }}>
            Ideal probabilities · state at {step.gate_index < 0 ? 'start' : `${step.label}`}
          </span>
        </div>
        <HistogramChart data={data} srDescription={srDescription} />
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

  const data = getHistogramData(result, viewMode);

  const handleExportCSV = () => {
    const header = 'State,Probability\n';
    const rows = data.map(d => `${d.state},${d.probability.toFixed(6)}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nuclei_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Screen reader description
  const srDescription = data.map(d => `${d.state}: ${(d.probability * 100).toFixed(1)}% probability`).join(', ');

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

        <div style={{ flex: 1 }} />

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
      <div ref={chartRef} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <HistogramChart data={data} srDescription={srDescription} />
      </div>
    </div>
  );
}
