import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { QecCsvDropZone } from './QecCsvDropZone';
import { isWebBuild } from '../../platform/buildTarget';
import { QecLambdaReadout } from './QecLambdaReadout';
import { QecPlotView } from './QecPlotView';
import { ScrollFade } from './ScrollFade';
import { useElementSize } from '../../hooks/useElementSize';
import { buildPlotModel } from '../../lib/qecPlotModel';
import { plotBox, READOUT_WIDTH } from '../../lib/qecPlotLayout';
import { figureFooterLines } from '../../lib/qecFigureText';
import {
  DEFAULT_MAX_LIKELIHOOD_FACTOR,
  lambdaEstimates,
  likelihoodSeries,
  qecFigureMetadata,
  roundsFromMetadata,
  whiskerConvention,
  type RateUnits,
} from '../../lib/qecFit';
import { renderFigureSvg } from '../../lib/qecSvgExport';
import { qecRatesToCsv } from '../../lib/qecExport';
import { downloadCsv, downloadSvg } from '../../services/experimentExport';
import { QEC_PLOT_CSV_DOCS } from '../../config/docsLinks';

import { TYPOGRAPHY } from '../../styles/tokens';
const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';

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
export function ThresholdPanel() {
  const colors = useThemeStore((s) => s.colors);
  const mode = useThemeStore((s) => s.mode);
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const rows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  const [areaRef, area] = useElementSize<HTMLDivElement>();

  const [requestedUnits, setRequestedUnits] = useState<RateUnits>('per_round');
  const roundsKnown = useMemo(() => rows.some((r) => roundsFromMetadata(r.json_metadata) !== null), [rows]);
  const units: RateUnits = roundsKnown ? requestedUnits : 'per_shot';
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

  const originals = useMemo(
    () => (csvImport ? new Map(csvImport.rows.map((r) => [r.strong_id, r])) : undefined),
    [csvImport],
  );
  const emptyBody = csvImport
    ? 'Nothing to plot yet: choose a numeric column for p in the mapping above.'
    : isWebBuild()
      ? 'Drop a sinter stats CSV to see logical error rate vs physical error, per distance.'
      : 'Run a QEC campaign over a noise sweep, or drop a sinter stats CSV, to see logical error rate vs physical error, per distance.';

  const exportSvg = () => {
    if (!model) return;
    const svg = renderFigureSvg({
      model, colors, metadata, title: meta.title, footerLines: figureFooterLines(lambdas),
      description: `${meta.units} versus physical error p, log-log. ${meta.ci_method}.`,
    });
    downloadSvg(svg, 'logical-error-vs-p.svg');
  };

  const header = (
    <PanelHeader
      title="Logical error vs physical error"
      helpHref={DOCS}
      actions={
        model ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {roundsKnown && <UnitsToggle units={units} onChange={setRequestedUnits} colors={colors} />}
            <ExportButton label="SVG" onClick={exportSvg} colors={colors} />
            <ExportButton label="CSV" onClick={() => downloadCsv(qecRatesToCsv(rows, { units, originals }), 'logical-error-vs-p.csv')} colors={colors} />
          </div>
        ) : undefined
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
          <QecCsvDropZone />
        </QecEmptyState>
      </div>
    );
  }

  const decoders = [...new Set(series.map((s) => s.decoder))].sort();
  const box = plotBox(area);
  const readoutBody = (
    <>
      <QecLambdaReadout decoders={decoders} estimates={lambdas} units={units} colors={colors} />
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
  const readout = box.layout === 'row' ? (
    <ScrollFade style={{ fontFamily: readoutFont, width: READOUT_WIDTH, flex: 'none', maxHeight: box.plotH }}>
      {readoutBody}
    </ScrollFade>
  ) : (
    <div style={{ fontFamily: readoutFont, padding: '0 12px' }}>{readoutBody}</div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div ref={areaRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: box.layout === 'row' ? 'row' : 'column', gap: 12, alignItems: 'flex-start', padding: box.layout === 'row' ? '4px 12px 8px 0' : '4px 0 10px' }}>
          <QecPlotView
            model={model} colors={colors} width={box.plotW} height={box.plotH}
            metadata={metadata} title={meta.title}
            description={`${meta.units} versus physical error p, log-log. ${meta.ci_method}.`}
          />
          {readout}
        </div>
      </div>
    </div>
  );
}

type Colors = ReturnType<typeof useThemeStore.getState>['colors'];

function UnitsToggle({ units, onChange, colors }: { units: RateUnits; onChange: (u: RateUnits) => void; colors: Colors }) {
  const opts: Array<[RateUnits, string]> = [['per_shot', 'Per shot'], ['per_round', 'Per round']];
  return (
    <div role="group" aria-label="Logical error units" style={{ display: 'flex', gap: 4, marginRight: 6 }}>
      {opts.map(([u, text]) => (
        <button
          key={u}
          type="button"
          aria-pressed={units === u}
          onClick={() => onChange(u)}
          style={{
            background: units === u ? colors.accent : 'transparent',
            color: units === u ? colors.bg : colors.textMuted,
            border: `1px solid ${colors.border}`, borderRadius: 4, cursor: 'pointer',
            fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap', fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function ExportButton({ label, onClick, colors }: { label: string; onClick: () => void; colors: Colors }) {
  return (
    <button
      onClick={onClick}
      title={`Export ${label}`}
      aria-label={`Export ${label}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
        border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted,
        cursor: 'pointer', fontSize: 11, padding: '4px 8px', fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      <Download size={12} /> {label}
    </button>
  );
}
