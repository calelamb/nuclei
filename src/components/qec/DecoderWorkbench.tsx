import { useDeferredValue, useMemo, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { decoderComparison, formatSecondsPerShot } from '../../lib/qecWorkbench';
import { decoderTableToCsv } from '../../lib/qecExport';
import { isWebBuild } from '../../platform/buildTarget';
import { useQecUnits } from '../../hooks/useQecUnits';
import { useElementSize } from '../../hooks/useElementSize';
import { QecUnitsToggle } from './QecUnitsToggle';
import { formatNoise, formatRateInterval } from '../../lib/qecPlotFormat';
import { downloadCsv } from '../../services/experimentExport';

import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button } from '../ui';
import './qecAnalysis.css';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';
const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';
/** Below this width an all-zero Discards column is dropped so the columns that matter stay on screen. */
const NARROW_TABLE_WIDTH = 720;

/**
 * PRD 10 Phase E — the decoder workbench. Same campaign, same circuits: a
 * side-by-side of each decoder at every (experiment, d, p) point, never pooled
 * across p, d or experiments. Rates are errors / (shots - discards) with the
 * same sinter likelihood-ratio interval as the figure; decode time per shot
 * comes from sinter's timing. Exports the table as CSV.
 */
export function DecoderWorkbench({ tabs, showUnits = true }: { tabs?: ReactNode; showUnits?: boolean } = {}) {
  const colors = useThemeStore((s) => s.colors);
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const liveRows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  const rows = useDeferredValue(liveRows);
  const { units, roundsKnown, setRequested } = useQecUnits();
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const unitText = units === 'per_round' ? 'per round' : 'per shot';
  const cmp = useMemo(() => decoderComparison(rows, { units }), [rows, units]);
  const wb = cmp.rows;
  const contexts = useMemo(() => [...new Set(wb.map((w) => w.context))], [wb]);
  const showExperiment = contexts.length > 1;
  const hideDiscards = area.width > 0 && area.width < NARROW_TABLE_WIDTH && wb.every((w) => w.discards === 0);

  const exportCsv = () => downloadCsv(decoderTableToCsv(cmp), 'decoder-workbench.csv');

  const header = (
    <PanelHeader
      title="Decoder Workbench"
      helpHref={DOCS}
      actions={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {tabs}
          {showUnits && wb.length > 0 && roundsKnown && <QecUnitsToggle units={units} onChange={setRequested} />}
          {wb.length > 0 && (
            <Button size="sm" onClick={exportCsv} title="Export the decoder table as CSV" aria-label="Export decoder table (CSV)" icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>
              CSV
            </Button>
          )}
        </div>
      }
    />
  );

  if (wb.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState title="No campaign results yet" body={isWebBuild()
          ? 'Drop a sinter stats CSV on the plot to compare decoders side by side.'
          : 'Run a QEC campaign, or drop a sinter stats CSV on the plot, to compare decoders side by side.'} docsHref={DOCS} />
      </div>
    );
  }

  const collisionTag = (w: (typeof wb)[number]) =>
    w.collides ? (
      <span title={`Another task has the same experiment, d and p (strong_id ${w.strongId}); shown separately, not pooled.`}
        style={{ color: colors.warning, marginLeft: 6 }}>task {w.strongId.slice(0, 6)}</span>
    ) : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div ref={areaRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Table label="Decoder comparison" className="decoder-table">
          <Thead>
            <Tr>
              <Th>Decoder</Th>
              {showExperiment && <Th>Experiment</Th>}
              <Th numeric plain>d</Th>
              <Th numeric plain>p</Th>
              <Th numeric>Logical error rate ({unitText})</Th>
              <Th numeric>Kept shots</Th>
              {!hideDiscards && <Th numeric>Discards</Th>}
              <Th numeric>Errors</Th>
              <Th numeric title="CPU core-seconds per shot (sampling + decoding), from sinter's seconds column">Time / shot</Th>
            </Tr>
          </Thead>
          <Tbody>
            {wb.map((w) => (
              <Tr key={`${w.experiment}|${w.decoder}|${w.distance}|${w.noise}|${w.strongId}`}>
                <Td text style={{ fontWeight: 500 }}>{w.decoder}</Td>
                {showExperiment && <Td text>{w.context}{collisionTag(w)}</Td>}
                <Td numeric>{w.distance ?? '—'}{!showExperiment && collisionTag(w)}</Td>
                <Td numeric>{w.noise === null ? '—' : formatNoise(w.noise)}</Td>
                <Td numeric>{formatRateInterval(w.rate.p, w.rate.lo, w.rate.hi)}</Td>
                <Td numeric>{w.kept.toLocaleString()}</Td>
                {!hideDiscards && <Td numeric>{w.discards.toLocaleString()}</Td>}
                <Td numeric>{w.errors.toLocaleString()}</Td>
                <Td numeric>{formatSecondsPerShot(w.secondsPerShot)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
      <div
        style={{
          padding: '6px 10px', fontSize: 11, color: colors.textDim,
          borderTop: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        {!showExperiment && contexts[0] !== '' && `Experiment: ${contexts[0]}. `}
        {`Rate = errors / (shots − discards)${units === 'per_round' ? ', converted to a per-round rate' : ''}, sinter likelihood-ratio interval (factor ${cmp.maxLikelihoodFactor}, about 3.7σ). One row per task (experiment, d, p); tasks sharing metadata are listed separately, never pooled.`}
        {cmp.skipped > 0 && ` ${cmp.skipped} malformed or fully-discarded row(s) skipped.`}
      </div>
    </div>
  );
}
