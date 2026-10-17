import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { decoderComparison, formatSecondsPerShot } from '../../lib/qecWorkbench';
import { isWebBuild } from '../../platform/buildTarget';
import { downloadCsv } from '../../services/experimentExport';

import { TYPOGRAPHY } from '../../styles/tokens';
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
  const rows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  const cmp = useMemo(() => decoderComparison(rows), [rows]);
  const wb = cmp.rows;
  const contexts = useMemo(() => [...new Set(wb.map((w) => w.context))], [wb]);
  const showExperiment = contexts.length > 1;

  const exportCsv = () => {
    const cell = (v: string | number | null) => {
      const t = v === null ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv =
      'decoder,experiment,distance,noise,shots,discards,kept_shots,errors,logical_error_rate,ci_lo,ci_hi,ci_method,seconds_per_shot,strong_id,task_collision\n' +
      wb
        .map((w) => [
          w.decoder, w.experiment, w.distance, w.noise, w.shots, w.discards, w.kept, w.errors,
          w.rate.p, w.rate.lo, w.rate.hi, `likelihood_ratio_factor_${cmp.maxLikelihoodFactor}`, w.secondsPerShot, w.strongId, w.collides ? 'yes' : 'no',
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
          <button
            onClick={exportCsv}
            title="Export CSV"
            aria-label="Export CSV"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
              border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted,
              cursor: 'pointer', fontSize: 11, padding: '4px 8px', fontFamily: TYPOGRAPHY.fontSans,
            }}
          >
            <Download size={12} /> CSV
          </button>
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

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '6px 10px', color: colors.textMuted, fontSize: 10,
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${colors.border}`,
  };
  const td: React.CSSProperties = {
    padding: '6px 10px', fontSize: 11, color: colors.text, borderBottom: `1px solid ${colors.border}`,
    fontFamily: TYPOGRAPHY.fontMono,
  };
  const collisionTag = (w: (typeof wb)[number]) =>
    w.collides ? (
      <span title={`Another task has the same experiment, d and p (strong_id ${w.strongId}); shown separately, not pooled.`}
        style={{ color: colors.warning, marginLeft: 6 }}>task {w.strongId.slice(0, 6)}</span>
    ) : null;
  const pct = (v: number) => `${(v * 100).toPrecision(3)}%`;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: TYPOGRAPHY.fontSans }}>
          <thead>
            <tr>
              <th style={th}>Decoder</th>
              {showExperiment && <th style={th}>Experiment</th>}
              <th style={th}>d</th>
              <th style={th}>p</th>
              <th style={th}>Logical error rate (per shot)</th>
              <th style={th}>Kept shots</th>
              <th style={th}>Discards</th>
              <th style={th}>Errors</th>
              <th style={th} title="CPU core-seconds per shot (sampling + decoding), from sinter's seconds column">Time / shot</th>
            </tr>
          </thead>
          <tbody>
            {wb.map((w) => (
              <tr key={`${w.experiment}|${w.decoder}|${w.distance}|${w.noise}|${w.strongId}`}>
                <td style={{ ...td, color: colors.dirac, fontWeight: 600 }}>{w.decoder}</td>
                {showExperiment && <td style={td}>{w.context}{collisionTag(w)}</td>}
                <td style={td}>{w.distance ?? '—'}{!showExperiment && collisionTag(w)}</td>
                <td style={td}>{w.noise ?? '—'}</td>
                <td style={td}>
                  {pct(w.rate.p)}{' '}
                  <span style={{ color: colors.textMuted, fontSize: 10.5 }}>
                    [{pct(w.rate.lo)}, {pct(w.rate.hi)}]
                  </span>
                </td>
                <td style={td}>{w.kept.toLocaleString()}</td>
                <td style={td}>{w.discards.toLocaleString()}</td>
                <td style={td}>{w.errors.toLocaleString()}</td>
                <td style={td}>{formatSecondsPerShot(w.secondsPerShot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          padding: '5px 10px', fontSize: 10, color: colors.textDim,
          borderTop: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        {!showExperiment && contexts[0] !== '' && `Experiment: ${contexts[0]}. `}
        {`Rate = errors / (shots − discards), sinter likelihood-ratio interval (factor ${cmp.maxLikelihoodFactor}, about 3.7σ). One row per task (experiment, d, p); tasks sharing metadata are listed separately, never pooled.`}
        {cmp.skipped > 0 && ` ${cmp.skipped} malformed or fully-discarded row(s) skipped.`}
      </div>
    </div>
  );
}
