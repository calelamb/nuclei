import { useMemo, useRef, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentStore } from '../../services/experimentStore';
import { DEFAULT_RUNS_VIEW, useExperimentUiStore } from '../../stores/experimentUiStore';
import { seriesColor } from '../../lib/seriesPalette';
import { buildSweepSeries, findFailedMarkers, pickDefaultMetric } from '../../services/sweepPlot';
import { toCsv, downloadCsv, downloadSvg } from '../../services/experimentExport';
import { deriveColumns } from './runsTableColumns';
import { SweepPlotChart } from './SweepPlotChart';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, Select } from '../ui';

function PickerField({ label, children }: { label: string; children: ReactNode }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>
      {label}
      {children}
    </label>
  );
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
    () => Object.keys(
      (experiment && experiment.spec.type !== 'qec_campaign' ? experiment.spec.sweep : undefined) ?? {},
    ),
    [experiment],
  );
  const metricNames = useMemo(
    () => deriveColumns(runs).filter((c) => c.kind === 'metric').map((c) => c.key),
    [runs],
  );

  // Picker choices persist per experiment (they survive leaving for run detail).
  const fileKey = selectedFileName ?? '';
  const view = useExperimentUiStore((s) => s.runsViewByExperiment[fileKey]) ?? DEFAULT_RUNS_VIEW;
  const patchRunsView = useExperimentUiStore((s) => s.patchRunsView);
  const selectRun = useExperimentUiStore((s) => s.selectRun);
  const setXParam = (v: string) => patchRunsView(fileKey, { sweepX: v, sweepGroup: null });
  const setYMetric = (v: string) => patchRunsView(fileKey, { sweepY: v });
  const setGroupParam = (v: string) => patchRunsView(fileKey, { sweepGroup: v });
  const svgRef = useRef<SVGSVGElement | null>(null);

  const effectiveX = view.sweepX && sweepParams.includes(view.sweepX) ? view.sweepX : sweepParams[0] ?? '';
  const effectiveY = view.sweepY && metricNames.includes(view.sweepY) ? view.sweepY : pickDefaultMetric(metricNames);
  const otherParams = sweepParams.filter((p) => p !== effectiveX);
  // A 2-param sweep defaults to grouping by the other parameter: ungrouped,
  // a line through points sharing an x draws a false sawtooth.
  const effectiveGroup = view.sweepGroup !== null && (view.sweepGroup === '' || otherParams.includes(view.sweepGroup))
    ? view.sweepGroup
    : otherParams[0] ?? '';

  if (!experiment) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        Select an experiment to see its sweep plot.
      </div>
    );
  }
  if (sweepParams.length === 0) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        This experiment has no swept parameters — nothing to plot.
      </div>
    );
  }
  if (metricNames.length === 0) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        No metrics recorded yet — run the sweep to populate the plot.
      </div>
    );
  }

  const series = buildSweepSeries(runs, effectiveX, effectiveY, effectiveGroup || undefined);
  const failed = findFailedMarkers(runs, effectiveX, effectiveGroup || undefined);
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
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <PickerField label="X">
          <Select size="sm" aria-label="X parameter" value={effectiveX} onChange={(e) => setXParam(e.target.value)}>
            {sweepParams.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </PickerField>
        <PickerField label="Y">
          <Select size="sm" aria-label="Y metric" value={effectiveY} onChange={(e) => setYMetric(e.target.value)}>
            {metricNames.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </PickerField>
        {otherParams.length > 0 && (
          <PickerField label="Group by">
            <Select size="sm" aria-label="Group by parameter" value={effectiveGroup} onChange={(e) => setGroupParam(e.target.value)}>
              <option value="">None</option>
              {otherParams.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </PickerField>
        )}

        <div style={{ flex: 1 }} />

        <Button size="sm" onClick={handleExportSvg} icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>SVG</Button>
        <Button size="sm" onClick={handleExportCsv} icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>CSV</Button>
      </div>

      {isGrouped && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
          {series.map((s, i) => (
            <div key={s.group ?? i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: colors.textMuted, fontFamily: TYPOGRAPHY.fontSans }}>
              <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-xs)', background: seriesColor(colors, i), display: 'inline-block' }} />
              {groupLabel(effectiveGroup, s.group)}
            </div>
          ))}
        </div>
      )}

      <SweepPlotChart series={series} xLabel={effectiveX} yLabel={effectiveY} groupLabel={effectiveGroup} failed={failed} onSelectRun={selectRun} svgRef={svgRef} />
    </div>
  );
}
