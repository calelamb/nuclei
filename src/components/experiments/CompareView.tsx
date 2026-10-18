import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Download, X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { runsDirForExperiment } from '../../services/experimentRunner';
import { diffManifests } from '../../services/manifestDiff';
import { toCsv, downloadCsv, downloadSvg } from '../../services/experimentExport';
import { seriesColor } from '../../lib/seriesPalette';
import { MultiSeriesHistogram, type MultiSeriesHistogramSeries } from '../histogram/MultiSeriesHistogram';
import { ManifestDiffTable } from './ManifestDiffTable';
import { CompareMetricsTable } from './CompareMetricsTable';
import type { RunRecord } from '../../types/experiment';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button } from '../ui';
import { formatRunLabel } from './runsTableColumns';

async function loadMeasurements(resultPath: string, fs: ReturnType<typeof createTauriExperimentFs>): Promise<Record<string, number>> {
  try {
    const text = await fs.readTextFile(resultPath);
    const parsed = JSON.parse(text) as { measurements?: Record<string, number> };
    return parsed.measurements ?? {};
  } catch {
    // A missing/corrupt result.json for one selected run shouldn't break the
    // whole comparison — it just contributes an empty (all-zero) series.
    return {};
  }
}

/** Legend entry: the shared run label, flagged when the run produced nothing to plot. */
function seriesLabel(run: RunRecord): string {
  const label = formatRunLabel(run.dir, run.manifest.started_at);
  return run.manifest.status === 'failed' ? `${label} (failed, no measurements)` : label;
}

function placeholderStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return { padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans } as const;
}

/**
 * PRD 09 Phase E (E1) — Compare view: 2+ runs checked in `RunsTable`, shown
 * side by side as an overlaid/grouped histogram, a manifest diff, and a
 * metrics table. Rendered by `PanelLayout` in place of `RunsTable`/
 * `RunDetail` while `experimentUiStore.compareOpen` is true.
 */
export function CompareView() {
  const colors = useThemeStore((s) => s.colors);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const compareSelection = useExperimentUiStore((s) => s.compareSelection);
  const closeCompare = useExperimentUiStore((s) => s.closeCompare);
  const clearCompareSelection = useExperimentUiStore((s) => s.clearCompareSelection);
  const experiments = useExperimentStore((s) => s.experiments);
  const runsByExperiment = useExperimentStore((s) => s.runsByExperiment);

  const experiment = experiments.find((e) => e.fileName === selectedFileName) ?? null;
  const allRuns = useMemo(
    () => (selectedFileName ? runsByExperiment[selectedFileName] ?? [] : []),
    [runsByExperiment, selectedFileName],
  );

  // Preserve the order runs were CHECKED in (not scan order) — keeps legend
  // colors stable as the selection changes.
  const runs = useMemo(
    () =>
      compareSelection
        .map((dir) => allRuns.find((r) => r.dir === dir))
        .filter((r): r is RunRecord => r !== undefined),
    [compareSelection, allRuns],
  );

  const [measurementsByDir, setMeasurementsByDir] = useState<Record<string, Record<string, number>>>({});
  const chartWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectRoot || !experiment || runs.length === 0) return;
    let cancelled = false;
    const fs = createTauriExperimentFs();
    const runsDir = runsDirForExperiment(fs.join, projectRoot, experiment.fileName);
    Promise.all(
      runs.map(async (run) => {
        const resultPath = fs.join(runsDir, run.dir, 'result.json');
        return [run.dir, await loadMeasurements(resultPath, fs)] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setMeasurementsByDir(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, experiment, runs]);

  if (!projectRoot || !experiment) {
    return <div style={placeholderStyle(colors)}>Select an experiment and 2 or more runs to compare.</div>;
  }

  if (runs.length < 2) {
    return (
      <div style={placeholderStyle(colors)}>
        <div style={{ marginBottom: 10 }}>Select at least 2 runs in the runs table to compare.</div>
        <Button variant="ghost" onClick={closeCompare} icon={<ArrowLeft size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}>
          Back to runs
        </Button>
      </div>
    );
  }

  const series: MultiSeriesHistogramSeries[] = runs.map((run, i) => ({
    label: seriesLabel(run),
    measurements: measurementsByDir[run.dir] ?? {},
    color: seriesColor(colors, i),
  }));

  const diff = diffManifests(runs.map((r) => r.manifest));

  const handleExportHistogramSvg = () => {
    const svg = chartWrapperRef.current?.querySelector('svg');
    if (svg) downloadSvg(svg, `${experiment.spec.name}-compare-histogram.svg`);
  };

  const handleExportMetricsCsv = () => {
    const metricNames = [...new Set(runs.flatMap((r) => Object.keys(r.metrics)))].sort();
    const columns = ['run', ...metricNames];
    const rows = runs.map((run) => ({ run: run.dir, ...run.metrics }));
    downloadCsv(toCsv(rows, columns), `${experiment.spec.name}-compare-metrics.csv`);
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', background: colors.bg }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 16px', borderBottom: `1px solid ${colors.border}`,
      }}>
        <Button variant="ghost" onClick={closeCompare} icon={<ArrowLeft size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}>
          Back to runs
        </Button>
        <span style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans }}>
          Compare {runs.length} runs
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearCompareSelection}
          title="Clear the comparison selection"
          icon={<X size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
          style={{ marginLeft: 'auto' }}
        >
          Clear selection
        </Button>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section>
          <SectionHeader title="Measurements" colors={colors}>
            <Button size="sm" onClick={handleExportHistogramSvg} icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>SVG</Button>
          </SectionHeader>
          <div ref={chartWrapperRef}>
            <MultiSeriesHistogram series={series} />
          </div>
        </section>

        <section>
          <SectionHeader title="Manifest diff" colors={colors} />
          <ManifestDiffTable diff={diff} runs={runs} />
        </section>

        <section>
          <SectionHeader title="Metrics" colors={colors}>
            <Button size="sm" onClick={handleExportMetricsCsv} icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>CSV</Button>
          </SectionHeader>
          <CompareMetricsTable runs={runs} precisionRuns={allRuns} />
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  children,
}: {
  title: string;
  colors: ReturnType<typeof useThemeStore.getState>['colors'];
  children?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
      <div className="nuclei-overline">
        {title}
      </div>
      <div style={{ marginLeft: 'auto' }}>{children}</div>
    </div>
  );
}
