import { TriangleAlert } from 'lucide-react';
import { MIN_LAMBDA_DISTANCES, type LambdaGroupEstimate, type RateUnits } from '../../lib/qecFit';
import { buildLambdaTable, type LambdaRowView } from '../../lib/qecLambdaTable';
import type { ThemeColors } from '../../stores/themeStore';
import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';
import './qecAnalysis.css';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';

interface Props {
  decoders: string[];
  estimates: LambdaGroupEstimate[];
  units: RateUnits;
  colors: ThemeColors;
}

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
      <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: colors.textMuted }}>
        Error suppression Λ
      </h3>
      {table.subtitle && <div style={{ fontSize: 11, color: colors.textMuted, margin: '2px 0 6px' }}>{table.subtitle}</div>}
      {table.groups.map((g) => (
        <div key={g.decoder} style={{ marginBottom: 8 }}>
          <Table label={`Λ for ${g.decoder}`} dense className="qec-lambda-table">
            <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600, padding: '4px 8px', color: colors.text }}>{g.decoder}</caption>
            <Thead>
              <Tr>
                <Th plain>p</Th>
                <Th numeric plain>Λ</Th>
                <Th numeric plain>95% CI</Th>
                <Th numeric plain>r²</Th>
                <Th aria-label="Warnings" />
              </Tr>
            </Thead>
            <Tbody>
              {g.rows.map((r) => <LambdaRow key={`${r.experiment}|${r.noise}`} row={r} colors={colors} />)}
            </Tbody>
            {g.collapsed && (
              <Tbody>
                <Tr>
                  <Td colSpan={5} text>
                    <details style={{ color: colors.textMuted, fontSize: 11 }}>
                      <summary style={{ cursor: 'pointer' }}>{g.collapsed.summary}</summary>
                      <Table label={`Λ for ${g.decoder}, rows not meaningful`} dense className="qec-lambda-table">
                        <Tbody>
                          {g.collapsed.rows.map((r) => <LambdaRow key={`${r.experiment}|${r.noise}`} row={r} colors={colors} />)}
                        </Tbody>
                      </Table>
                    </details>
                  </Td>
                </Tr>
              </Tbody>
            )}
          </Table>
        </div>
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
  const tone = row.meaningful ? colors.text : colors.textMuted;
  return (
    <Tr>
      <Td style={{ color: tone }}>
        {row.p}
        {row.experiment && <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: TYPOGRAPHY.fontSans }}>{row.experiment}</div>}
      </Td>
      <Td numeric style={{ color: tone, fontWeight: row.meaningful ? 600 : 400 }}>{row.lambda}</Td>
      <Td numeric style={{ color: tone }}>{row.ci ?? '—'}</Td>
      <Td numeric style={{ color: tone }}>{row.rSquared}</Td>
      <Td>
        {row.flags.length > 0 && (
          <span role="img" aria-label={`Warnings: ${row.flags.join('; ')}`} title={flagText} style={{ color: colors.warning, display: 'inline-flex' }}>
            <TriangleAlert size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </span>
        )}
      </Td>
    </Tr>
  );
}
