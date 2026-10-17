import { TriangleAlert } from 'lucide-react';
import { MIN_LAMBDA_DISTANCES, type LambdaGroupEstimate, type RateUnits } from '../../lib/qecFit';
import { buildLambdaTable, type LambdaRowView } from '../../lib/qecLambdaTable';
import type { ThemeColors } from '../../stores/themeStore';
import { ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';

interface Props {
  decoders: string[];
  estimates: LambdaGroupEstimate[];
  units: RateUnits;
  colors: ThemeColors;
}

const CELL = { padding: '3px 6px', fontVariantNumeric: 'tabular-nums' as const };

/**
 * Λ per decoder as a table: p, Λ, 95% interval, r². Rows whose interval is not
 * meaningful (saturated, above threshold) fold into one summary line, each
 * distinct caveat is stated once, and per-row detail sits in the warning icon's
 * tooltip. Same numbers and caveats as the exported figure and Dirac.
 */
export function QecLambdaReadout({ decoders, estimates, units, colors }: Props) {
  const table = buildLambdaTable(estimates, units);
  const withoutFit = decoders.filter((d) => !table.groups.some((g) => g.decoder === d));
  return (
    <section aria-label="Error suppression factor Λ" style={{ fontFamily: TYPOGRAPHY.fontSans, fontSize: 12, color: colors.text }}>
      <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textMuted }}>
        Error suppression Λ
      </h3>
      {table.subtitle && <div style={{ fontSize: 11, color: colors.textMuted, margin: '2px 0 6px' }}>{table.subtitle}</div>}
      {table.groups.map((g) => (
        <table key={g.decoder} style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600, padding: '4px 6px' }}>{g.decoder}</caption>
          <thead>
            <tr style={{ color: colors.textMuted, fontSize: 11 }}>
              <th scope="col" style={{ ...CELL, textAlign: 'left', fontWeight: 500 }}>p</th>
              <th scope="col" style={{ ...CELL, textAlign: 'right', fontWeight: 500 }}>Λ</th>
              <th scope="col" style={{ ...CELL, textAlign: 'right', fontWeight: 500 }}>95% CI</th>
              <th scope="col" style={{ ...CELL, textAlign: 'right', fontWeight: 500 }}>r²</th>
              <th scope="col" aria-label="Warnings" style={{ ...CELL, width: 18 }} />
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => <LambdaRow key={`${r.experiment}|${r.noise}`} row={r} colors={colors} />)}
          </tbody>
          {g.collapsed && (
            <tbody>
              <tr>
                <td colSpan={5} style={{ padding: '2px 0 0' }}>
                  <details style={{ color: colors.textMuted, fontSize: 11 }}>
                    <summary style={{ cursor: 'pointer', padding: '2px 6px' }}>{g.collapsed.summary}</summary>
                    <table style={{ width: '100%', borderCollapse: 'collapse', opacity: 0.85 }}>
                      <tbody>
                        {g.collapsed.rows.map((r) => <LambdaRow key={`${r.experiment}|${r.noise}`} row={r} colors={colors} />)}
                      </tbody>
                    </table>
                  </details>
                </td>
              </tr>
            </tbody>
          )}
        </table>
      ))}
      {withoutFit.map((d) => (
        <div key={d} style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>
          <strong style={{ color: colors.text }}>{d}</strong>
          {`: Λ not estimated, needs ≥ ${MIN_LAMBDA_DISTANCES} distances at the same p`}
        </div>
      ))}
      {table.notes.length > 0 && (
        <ul style={{ margin: '0 0 6px', padding: 0, listStyle: 'none', fontSize: 11, color: colors.warning }}>
          {table.notes.map((n) => <li key={n} role="note">{n}</li>)}
        </ul>
      )}
    </section>
  );
}

function LambdaRow({ row, colors }: { row: LambdaRowView; colors: ThemeColors }) {
  const flagText = row.flags.join('\n');
  return (
    <tr style={{ borderTop: `1px solid ${colors.border}`, color: row.meaningful ? colors.text : colors.textMuted }}>
      <td style={{ ...CELL, textAlign: 'left' }}>
        {row.p}
        {row.experiment && <div style={{ fontSize: 11, color: colors.textMuted }}>{row.experiment}</div>}
      </td>
      <td style={{ ...CELL, textAlign: 'right', fontWeight: row.meaningful ? 600 : 400 }}>{row.lambda}</td>
      <td style={{ ...CELL, textAlign: 'right' }}>{row.ci ?? '—'}</td>
      <td style={{ ...CELL, textAlign: 'right' }}>{row.rSquared}</td>
      <td style={{ ...CELL, width: 18 }}>
        {row.flags.length > 0 && (
          <span role="img" aria-label={`Warnings: ${row.flags.join('; ')}`} title={flagText} style={{ color: colors.warning, display: 'inline-flex' }}>
            <TriangleAlert size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </span>
        )}
      </td>
    </tr>
  );
}
