import { useDeferredValue, useMemo } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { decoderComparison, formatSecondsPerShot } from '../../lib/qecWorkbench';
import { isWebBuild } from '../../platform/buildTarget';
import { useQecUnits } from '../../hooks/useQecUnits';
import { formatNoise, formatRateInterval } from '../../lib/qecPlotFormat';
import { downloadCsv } from '../../services/experimentExport';

import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button } from '../ui';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';
const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';

/**
 * PRD 10 Phase E — the decoder workbench. Same campaign, same circuits: a
 * side-by-side of each decoder at every (experiment, d, p) point, never pooled
 * across p, d or experiments. Rates are errors / (shots - discards) with the
 * same sinter likelihood-ratio interval as the figure; decode time per shot
 * comes from sinter's timing. Exports the table as CSV.
 */
export function DecoderWorkbench() {
  const colors = useThemeStore((s) => s.colors);
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const liveRows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  const rows = useDeferredValue(liveRows);
  const { units } = useQecUnits();
  const unitText = units === 'per_round' ? 'per round' : 'per shot';
  const cmp = useMemo(() => decoderComparison(rows, { units }), [rows, units]);
  const wb = cmp.rows;
  const contexts = useMemo(() => [...new Set(wb.map((w) => w.context))], [wb]);
  const showExperiment = contexts.length > 1;

  const exportCsv = () => {
    const cell = (v: string | number | null) => {
      const t = v === null ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv =
      'decoder,experiment,distance,noise,shots,discards,kept_shots,errors,logical_error_rate,ci_lo,ci_hi,units,ci_method,seconds_per_shot,strong_id,task_collision\n' +
      wb
        .map((w) => [
          w.decoder, w.experiment, w.distance, w.noise, w.shots, w.discards, w.kept, w.errors,
          w.rate.p, w.rate.lo, w.rate.hi, w.units, `likelihood_ratio_factor_${cmp.maxLikelihoodFactor}`, w.secondsPerShot, w.strongId, w.collides ? 'yes' : 'no',
        ].map(cell).join(','))
        .join('\n') +
      '\n';
    downloadCsv(csv, 'decoder-workbench.csv');
  };

  const header = (
    <PanelHeader
      title="Decoder Workbench"
      helpHref={DOCS}
      actions={
        wb.length > 0 ? (
          <Button size="sm" onClick={exportCsv} title="Export the decoder table as CSV" aria-label="Export decoder table (CSV)" icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}>
            CSV
          </Button>
        ) : undefined
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
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Table label="Decoder comparison" className="decoder-table">
          <Thead>
            <Tr>
              <Th>Decoder</Th>
              {showExperiment && <Th>Experiment</Th>}
              <Th numeric plain>d</Th>
              <Th numeric plain>p</Th>
              <Th numeric>Logical error rate ({unitText})</Th>
              <Th numeric>Kept shots</Th>
              <Th numeric>Discards</Th>
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
                <Td numeric>{w.discards.toLocaleString()}</Td>
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
