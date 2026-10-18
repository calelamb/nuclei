import { useDeferredValue, useMemo, type ReactNode } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { QecCsvDropZone } from './QecCsvDropZone';
import { isWebBuild } from '../../platform/buildTarget';
import { QecLambdaReadout } from './QecLambdaReadout';
import { QecUnitsToggle } from './QecUnitsToggle';
import { useQecUnits } from '../../hooks/useQecUnits';
import { Button } from '../ui';
import { QecPlotView } from './QecPlotView';
import { ScrollFade } from './ScrollFade';
import { useElementSize } from '../../hooks/useElementSize';
import { buildPlotModel } from '../../lib/qecPlotModel';
import { MIN_PLOT_W, plotBox, READOUT_WIDTH } from '../../lib/qecPlotLayout';
import { figureFooterLines, lambdaLine } from '../../lib/qecFigureText';
import {
  DEFAULT_MAX_LIKELIHOOD_FACTOR,
  lambdaEstimates,
  likelihoodSeries,
  qecFigureMetadata,
  whiskerConvention,
} from '../../lib/qecFit';
import { PRINT_COLORS, renderFigureSvg } from '../../lib/qecSvgExport';
import { qecRatesToCsv } from '../../lib/qecExport';
import { downloadCsv, downloadSvg } from '../../services/experimentExport';
import './qecAnalysis.css';
import { QEC_PLOT_CSV_DOCS } from '../../config/docsLinks';

import { TYPOGRAPHY } from '../../styles/tokens';
const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';
const PLOT_ONLY_PAD = 24;
/** Below this panel width the title would be squeezed out, so the units toggle moves below the header and both labelled exports stay. */
const COMPACT_HEADER_WIDTH = 620;

function ExportButton({ label, title, ariaLabel, onClick }: {
  label: string; title: string; ariaLabel: string; onClick: () => void;
}) {
  return <Button size="sm" onClick={onClick} title={title} aria-label={ariaLabel}>{label}</Button>;
}

/**
 * Logical error vs physical error. Logical error rate (per shot, or per round
 * when the campaign records rounds) against the noise parameter on log-log
 * axes. Colour encodes distance, marker shape the decoder, dash the
 * experiment; whiskers are sinter's likelihood-ratio interval. Λ is estimated
 * by log-linear regression of LER vs distance at each p (>= 3 distances) and
 * shown with its interval. No threshold p_th is estimated, so none is claimed.
 * Exports SVG + CSV; the SVG embeds a <metadata> block naming the estimators,
 * CI method and units.
 */
/** Which half of the figure to show: both side by side, only the plot, or only the Λ readout. */
export type ThresholdPart = 'all' | 'plot' | 'lambda';

export function ThresholdPanel({ part = 'all', tabs }: { part?: ThresholdPart; tabs?: ReactNode } = {}) {
  const colors = useThemeStore((s) => s.colors);
  const mode = useThemeStore((s) => s.mode);
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const liveRows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  // A mapping change on a big file recomputes every series and fit: keep the
  // controls responsive and show the new plot when it is ready.
  const rows = useDeferredValue(liveRows);
  const updating = rows !== liveRows;
  const [areaRef, area] = useElementSize<HTMLDivElement>();

  const { units, roundsKnown, setRequested } = useQecUnits();
  const { series, excluded, invalid, noKept } = useMemo(() => likelihoodSeries(rows, { units }), [rows, units]);
  const lambdas = useMemo(() => lambdaEstimates(rows, { units }), [rows, units]);
  const csvImport = useQecCampaignStore((s) => s.csvImport);
  const campaignName = useQecCampaignStore((s) => s.campaignName);
  const meta = useMemo(
    () => qecFigureMetadata(units, DEFAULT_MAX_LIKELIHOOD_FACTOR, lambdas, {
      file: csvImport?.sourceName ?? campaignName, rows,
    }),
    [units, lambdas, rows, csvImport, campaignName],
  );
  const metadata = useMemo(() => JSON.stringify(meta), [meta]);
  const hasDiscards = useMemo(() => rows.some((r) => r.discards > 0), [rows]);
  const model = useMemo(() => buildPlotModel(series, mode, colors.textMuted, units), [series, mode, colors.textMuted, units]);

  // Rows folded together as replicates have no single source row to quote, so
  // the CSV export only quotes the file's own metadata for unmerged data.
  const originals = useMemo(
    () => (csvImport && rows.length === csvImport.rows.length ? new Map(csvImport.rows.map((r) => [r.strong_id, r])) : undefined),
    [csvImport, rows.length],
  );
  const emptyBody = csvImport
    ? 'Nothing to plot yet: choose the column that holds the physical error rate p under Edit mapping.'
    : isWebBuild()
      ? 'Drop a sinter stats CSV to see logical error rate vs physical error, per distance.'
      : 'Run a QEC campaign over a noise sweep, or drop a sinter stats CSV, to see logical error rate vs physical error, per distance.';

  const exportSvg = () => {
    if (!model) return;
    // Paper style: white page, dark text, light-palette series colours,
    // whatever the app theme. Λ detail lives in <metadata>, not on the figure.
    const printModel = buildPlotModel(series, 'light', PRINT_COLORS.textMuted, units);
    if (!printModel) return;
    const svg = renderFigureSvg({
      model: printModel, metadata, title: meta.title, footerLines: figureFooterLines(lambdas),
      description: [`${meta.units} versus physical error p, log-log. ${meta.ci_method}.`, ...lambdas.map(lambdaLine)].join('\n'),
    });
    downloadSvg(svg, 'logical-error-vs-p.svg');
  };

  const compact = area.width > 0 && area.width < COMPACT_HEADER_WIDTH;
  const header = (
    <PanelHeader
      title={part === 'lambda' ? 'Error suppression Λ' : 'Logical error vs p'}
      helpHref={DOCS}
      actions={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {tabs}
          {model && roundsKnown && !compact && <QecUnitsToggle units={units} onChange={setRequested} />}
          {model && part !== 'lambda' && (
            <>
              <ExportButton
                label="SVG" onClick={exportSvg}
                title="Export the plot as a print-ready SVG (white background)" ariaLabel="Export plot as SVG"
              />
              <ExportButton
                label="CSV" onClick={() => downloadCsv(qecRatesToCsv(rows, { units, originals }), 'logical-error-vs-p.csv')}
                title="Export the plotted rates as CSV" ariaLabel="Export plot data (CSV)"
              />
            </>
          )}
        </div>
      }
    />
  );

  if (!model) {
    const unplottable = series.length > 0;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState
          title={csvImport || unplottable ? 'No plottable points' : 'No campaign results yet'}
          body={unplottable
            ? 'Every point has p = 0 or a zero rate, which cannot be placed on log-log axes.'
            : emptyBody}
          docsHref={QEC_PLOT_CSV_DOCS}
        >
          {!csvImport && <QecCsvDropZone />}
        </QecEmptyState>
      </div>
    );
  }

  const decoders = [...new Set(series.map((s) => s.decoder))].sort();
  // Plot alone: the readout's column is not reserved, so the plot takes the full width and the full height.
  const fullBox = plotBox(area, { fill: part === 'plot' });
  const box = part === 'plot' && fullBox.layout === 'row'
    ? { layout: 'stack' as const, plotW: Math.max(MIN_PLOT_W, area.width - PLOT_ONLY_PAD), plotH: fullBox.plotH }
    : fullBox;
  const readoutBody = (
    <>
      <QecLambdaReadout decoders={decoders} estimates={lambdas} units={units} colors={colors} hideTitle={part === 'lambda'} />
      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 1.45 }}>
        {`Whiskers: sinter ${whiskerConvention()}, `}
        {hasDiscards ? 'on shots − discards. ' : 'on shots. '}
        {excluded > 0 && `${excluded} row(s) without known rounds are hidden in per-round view. `}
        {invalid > 0 && `${invalid} malformed row(s) (errors exceed kept shots) skipped. `}
        {noKept > 0 && `${noKept} row(s) with every shot discarded skipped. `}
        No threshold p_th is estimated.
      </div>
    </>
  );
  const readoutFont = TYPOGRAPHY.fontSans;
  const readout = part === 'plot' ? null : box.layout === 'row' && part === 'all' ? (
    <ScrollFade style={{ fontFamily: readoutFont, width: READOUT_WIDTH, flex: 'none', maxHeight: box.plotH }}>
      {readoutBody}
    </ScrollFade>
  ) : (
    <div style={{ fontFamily: readoutFont, padding: '0 12px' }}>{readoutBody}</div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div ref={areaRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        {updating && (
          <div
            role="status"
            style={{
              position: 'absolute', top: 6, right: 12, zIndex: 3, padding: '3px 8px', borderRadius: 'var(--radius-xs)', fontSize: 11,
              background: colors.bgElevated, color: colors.textMuted, border: `1px solid ${colors.border}`,
              animation: 'nuclei-fade-in 120ms ease 150ms backwards', fontFamily: TYPOGRAPHY.fontSans,
            }}
          >
            Updating plot…
          </div>
        )}
        {roundsKnown && compact && (
          <div style={{ padding: '6px 12px 8px' }}><QecUnitsToggle units={units} onChange={setRequested} /></div>
        )}
        <div style={{ display: 'flex', flexDirection: box.layout === 'row' ? 'row' : 'column', gap: 12, alignItems: 'flex-start', padding: box.layout === 'row' ? '4px 12px 8px 0' : '4px 0 10px' }}>
          {part !== 'lambda' && (
            <QecPlotView
              model={model} colors={colors} width={box.plotW} height={box.plotH}
              metadata={metadata} title={meta.title}
              description={`${meta.units} versus physical error p, log-log. ${meta.ci_method}.`}
            />
          )}
          {readout}
        </div>
      </div>
    </div>
  );
}
