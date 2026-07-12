import { useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { seriesColor } from '../../lib/seriesPalette';
import { buildSweepSeries } from '../../services/sweepPlot';
import { toCsv, downloadCsv, downloadSvg } from '../../services/experimentExport';
import { deriveColumns } from './runsTableColumns';
import { SweepPlotChart } from './SweepPlotChart';

function pickerStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return {
    background: colors.bgPanel, color: colors.text,
    border: `1px solid ${colors.border}`, borderRadius: 4, padding: '3px 8px',
    fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
  };
}

function groupLabel(groupParam: string, group: string | null): string {
  if (group === null) return '';
  return groupParam ? `${groupParam} = ${group}` : group;
}

/**
 * PRD 09 Phase E (E2) — the "money shot": metric-vs-swept-parameter plot,
 * with a color/legend group when a second swept parameter is available.
 * Reachable from `RunsTable`'s "Sweep plot" tab. All data shaping lives in
 * the pure `buildSweepSeries`; this component is pickers + export wiring.
 */
export function SweepPlot() {
  const colors = useThemeStore((s) => s.colors);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const experiments = useExperimentStore((s) => s.experiments);
  const runsByExperiment = useExperimentStore((s) => s.runsByExperiment);

  const experiment = experiments.find((e) => e.fileName === selectedFileName) ?? null;
  const runs = useMemo(
    () => (selectedFileName ? runsByExperiment[selectedFileName] ?? [] : []),
    [runsByExperiment, selectedFileName],
  );

  const sweepParams = useMemo(
    () => Object.keys(experiment?.spec.sweep ?? {}),
    [experiment],
  );
  const metricNames = useMemo(
    () => deriveColumns(runs).filter((c) => c.kind === 'metric').map((c) => c.key),
    [runs],
  );

  const [xParam, setXParam] = useState('');
  const [yMetric, setYMetric] = useState('');
  const [groupParam, setGroupParam] = useState('');
  const svgRef = useRef<SVGSVGElement | null>(null);

  const effectiveX = sweepParams.includes(xParam) ? xParam : sweepParams[0] ?? '';
  const effectiveY = metricNames.includes(yMetric) ? yMetric : metricNames[0] ?? '';
  const otherParams = sweepParams.filter((p) => p !== effectiveX);
  const effectiveGroup = otherParams.includes(groupParam) ? groupParam : '';

  if (!experiment) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        Select an experiment to see its sweep plot.
      </div>
    );
  }
  if (sweepParams.length === 0) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        This experiment has no swept parameters — nothing to plot.
      </div>
    );
  }
  if (metricNames.length === 0) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        No metrics recorded yet — run the sweep to populate the plot.
      </div>
    );
  }

  const series = buildSweepSeries(runs, effectiveX, effectiveY, effectiveGroup || undefined);
  const isGrouped = series.length > 1 || (series.length === 1 && series[0].group !== null);

  const handleExportSvg = () => {
    if (svgRef.current) downloadSvg(svgRef.current, `${experiment.spec.name}-sweep.svg`);
  };

  const handleExportCsv = () => {
    const rows = series.flatMap((s) =>
      s.points.map((p) => ({ group: s.group ?? '', x: p.x, y: p.y, run: p.dir })),
    );
    downloadCsv(toCsv(rows, ['group', 'x', 'y', 'run']), `${experiment.spec.name}-sweep.csv`);
  };

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}>
          X
          <select aria-label="X parameter" value={effectiveX} onChange={(e) => setXParam(e.target.value)} style={pickerStyle(colors)}>
            {sweepParams.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}>
          Y
          <select aria-label="Y metric" value={effectiveY} onChange={(e) => setYMetric(e.target.value)} style={pickerStyle(colors)}>
            {metricNames.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {otherParams.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}>
            Group by
            <select aria-label="Group by parameter" value={effectiveGroup} onChange={(e) => setGroupParam(e.target.value)} style={pickerStyle(colors)}>
              <option value="">None</option>
              {otherParams.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={handleExportSvg} style={exportButtonStyle(colors)}>
          <Download size={12} /> SVG
        </button>
        <button onClick={handleExportCsv} style={exportButtonStyle(colors)}>
          <Download size={12} /> CSV
        </button>
      </div>

      {isGrouped && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
          {series.map((s, i) => (
            <div key={s.group ?? i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: colors.textMuted, fontFamily: "'Geist Sans', sans-serif" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: seriesColor(colors, i), display: 'inline-block' }} />
              {groupLabel(effectiveGroup, s.group)}
            </div>
          ))}
        </div>
      )}

      <SweepPlotChart series={series} xLabel={effectiveX} yLabel={effectiveY} svgRef={svgRef} />
    </div>
  );
}

function exportButtonStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 10px', background: 'transparent', border: `1px solid ${colors.border}`,
    borderRadius: 4, color: colors.textMuted, cursor: 'pointer' as const,
    fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
  };
}
