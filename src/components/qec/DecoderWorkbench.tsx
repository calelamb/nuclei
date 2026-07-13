import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { decoderWorkbench } from '../../types/qecStats';
import { downloadCsv } from '../../services/experimentExport';

const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';

/**
 * PRD 10 Phase E — the decoder workbench. Same campaign, same circuits: an
 * honest side-by-side of each decoder's pooled logical error rate (± Wilson
 * CI), shots and errors collected, and decode time per shot (from sinter's
 * timing). Exports the table as CSV.
 */
export function DecoderWorkbench() {
  const colors = useThemeStore((s) => s.colors);
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const rows = useMemo(() => Object.values(rowsByStrongId), [rowsByStrongId]);
  const wb = useMemo(() => decoderWorkbench(rows), [rows]);

  const exportCsv = () => {
    const csv =
      'decoder,logical_error_rate,ci_lo,ci_hi,shots,errors,seconds_per_shot\n' +
      wb
        .map((w) => [w.decoder, w.rate.p, w.rate.lo, w.rate.hi, w.shots, w.errors, w.secondsPerShot].join(','))
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
              cursor: 'pointer', fontSize: 11, padding: '4px 8px', fontFamily: "'Geist Sans', sans-serif",
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
        <QecEmptyState title="No campaign results yet" body="Run a QEC campaign to compare decoders side by side." docsHref={DOCS} />
      </div>
    );
  }

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '6px 10px', color: colors.textDim, fontSize: 10,
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${colors.border}`,
  };
  const td: React.CSSProperties = {
    padding: '6px 10px', fontSize: 11, color: colors.text, borderBottom: `1px solid ${colors.border}`,
    fontFamily: "'Fira Code', monospace",
  };
  const pct = (v: number) => `${(v * 100).toPrecision(3)}%`;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'Geist Sans', sans-serif" }}>
          <thead>
            <tr>
              <th style={th}>Decoder</th>
              <th style={th}>Logical error rate</th>
              <th style={th}>Shots</th>
              <th style={th}>Errors</th>
              <th style={th}>s / shot</th>
            </tr>
          </thead>
          <tbody>
            {wb.map((w) => (
              <tr key={w.decoder}>
                <td style={{ ...td, color: colors.dirac, fontWeight: 600 }}>{w.decoder}</td>
                <td style={td}>
                  {pct(w.rate.p)}{' '}
                  <span style={{ color: colors.textDim, fontSize: 10 }}>
                    [{pct(w.rate.lo)}, {pct(w.rate.hi)}]
                  </span>
                </td>
                <td style={td}>{w.shots.toLocaleString()}</td>
                <td style={td}>{w.errors.toLocaleString()}</td>
                <td style={td}>{w.secondsPerShot.toPrecision(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          padding: '5px 10px', fontSize: 10, color: colors.textDim,
          borderTop: `1px solid ${colors.border}`, fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        Wilson 95% CIs · same circuits, same shots budget
      </div>
    </div>
  );
}
