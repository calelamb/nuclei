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

function placeholderStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return { padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" } as const;
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
        <button onClick={closeCompare} style={backButtonStyle(colors)}>
          <ArrowLeft size={13} /> Back to runs
        </button>
      </div>
    );
  }

  const series: MultiSeriesHistogramSeries[] = runs.map((run, i) => ({
    label: run.dir,
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
        padding: '10px 14px', borderBottom: `1px solid ${colors.border}`,
      }}>
        <button onClick={closeCompare} style={backButtonStyle(colors)}>
          <ArrowLeft size={13} /> Back to runs
        </button>
        <span style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif" }}>
          Compare {runs.length} runs — {experiment.spec.name}
        </span>
        <button
          onClick={clearCompareSelection}
          title="Clear the comparison selection"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}
        >
          <X size={13} /> Clear selection
        </button>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <section>
          <SectionHeader title="Measurements" colors={colors}>
            <button onClick={handleExportHistogramSvg} style={exportButtonStyle(colors)}>
              <Download size={12} /> SVG
            </button>
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
            <button onClick={handleExportMetricsCsv} style={exportButtonStyle(colors)}>
              <Download size={12} /> CSV
            </button>
          </SectionHeader>
          <CompareMetricsTable runs={runs} />
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  colors,
  children,
}: {
  title: string;
  colors: ReturnType<typeof useThemeStore.getState>['colors'];
  children?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
      <div style={{ color: colors.textDim, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      <div style={{ marginLeft: 'auto' }}>{children}</div>
    </div>
  );
}

function backButtonStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return {
    display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
    border: 'none', color: colors.textMuted, cursor: 'pointer' as const, fontSize: 12,
    fontFamily: "'Geist Sans', sans-serif", padding: 0,
  };
}

function exportButtonStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', background: 'transparent', border: `1px solid ${colors.border}`,
    borderRadius: 4, color: colors.textMuted, cursor: 'pointer' as const,
    fontSize: 10, fontFamily: "'Geist Sans', sans-serif",
  };
}
