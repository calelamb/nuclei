import { Fragment, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { LambdaGroupEstimate, RateUnits } from '../../lib/qecFit';
import type { QecCampaignStatsRow } from '../../types/qec';
import { buildLambdaTable, explainMissingLambda, lambdaRangeSummary, LAMBDA_ROW_LIMIT, type LambdaDecoderGroup, type LambdaRowView } from '../../lib/qecLambdaTable';
import type { ThemeColors } from '../../stores/themeStore';
import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';
import './qecAnalysis.css';
import { IconButton } from '../ui/IconButton';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';

interface Props {
  decoders: string[];
  estimates: LambdaGroupEstimate[];
  units: RateUnits;
  colors: ThemeColors;
  /** The panel header already carries this title (the Λ tab), so the readout does not repeat it. */
  hideTitle?: boolean;
  /** The stats rows behind the estimates, so a decoder without a Λ can say which distances it lacked. */
  rows?: readonly QecCampaignStatsRow[];
}

/**
 * Λ per decoder as a table: p, Λ, 95% interval, r². Rows whose interval is not
 * meaningful (saturated, above threshold) fold into one summary line, each
 * distinct caveat is stated once, and per-row detail sits in the warning icon's
 * tooltip. Same numbers and caveats as the exported figure and Dirac.
 */
export function QecLambdaReadout({ decoders, estimates, units, colors, hideTitle = false, rows = [] }: Props) {
  const table = buildLambdaTable(estimates, units);
  const withoutFit = decoders.filter((d) => !table.groups.some((g) => g.decoder === d));
  return (
    <section aria-label="Error suppression factor Λ" style={{ fontFamily: TYPOGRAPHY.fontSans, fontSize: 12, color: colors.text }}>
      {!hideTitle && (
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: colors.text }}>
          Error suppression Λ
        </h3>
      )}
      {table.subtitle && <div style={{ fontSize: 11, color: colors.textMuted, margin: '2px 0 6px' }}>{table.subtitle}</div>}
      {table.groups.map((g) => (
        <DecoderLambdaTable key={g.decoder} group={g} colors={colors} />
      ))}
      {withoutFit.map((d) => (
        <div key={d} style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>
          <strong style={{ color: colors.text }}>{d}</strong>
          : <NoBreakP text={explainMissingLambda(rows, d).replace(/^Λ not estimated: /, 'Λ not estimated, ')} />
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

/** Keeps "the same p" / "a shared p" together so a lone "p" never wraps onto its own line. */
function NoBreakP({ text }: { text: string }) {
  return (
    <>
      {text.split(/((?:the same|a shared) p)/).map((part, i) =>
        i % 2 === 1 ? <span key={i} style={{ whiteSpace: 'nowrap' }}>{part}</span> : part)}
    </>
  );
}

/** One decoder's Λ table: the first rows, a one-line range summary, and the rest on request. */
function DecoderLambdaTable({ group: g, colors }: { group: LambdaDecoderGroup; colors: ThemeColors }) {
  const [showAll, setShowAll] = useState(false);
  const overflow = g.rows.length > LAMBDA_ROW_LIMIT;
  const shown = overflow && !showAll ? g.rows.slice(0, LAMBDA_ROW_LIMIT) : g.rows;
  return (
    <div style={{ marginBottom: 8 }}>
      <Table label={`Λ for ${g.decoder}`} dense className="qec-lambda-table">
        <caption style={{ captionSide: 'top', textAlign: 'left', fontWeight: 600, padding: '4px 8px', color: colors.text }}>
          {g.decoder}
          {overflow && <span style={{ display: 'block', fontWeight: 400, fontSize: 11, color: colors.textMuted }}>{lambdaRangeSummary(g.rows)}</span>}
        </caption>
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
          <LambdaRows rows={shown} colors={colors} />
        </Tbody>
        {g.collapsed && (
          <Tbody>
            <Tr>
              <Td colSpan={5} text>
                <details style={{ color: colors.textMuted, fontSize: 11 }}>
                  <summary style={{ cursor: 'pointer' }}>{g.collapsed.summary}</summary>
                  <Table label={`Λ for ${g.decoder}, rows not meaningful`} dense className="qec-lambda-table">
                    <Tbody>
                      <LambdaRows rows={g.collapsed.rows} colors={colors} />
                    </Tbody>
                  </Table>
                </details>
              </Td>
            </Tr>
          </Tbody>
        )}
      </Table>
      {overflow && (
        <button type="button" className="qec-link-button" style={{ margin: '4px 8px' }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${g.rows.length}`}
        </button>
      )}
    </div>
  );
}

/** Rows in order; with several experiments each gets one sub-heading row instead of a label inside the p cell. */
function LambdaRows({ rows, colors }: { rows: readonly LambdaRowView[]; colors: ThemeColors }) {
  return (
    <>
      {rows.map((r, i) => (
        <Fragment key={`${r.experiment}|${r.noise}`}>
          {r.experiment !== null && r.experiment !== rows[i - 1]?.experiment && (
            <Tr className="qec-lambda-group">
              <Td colSpan={5} text style={{ color: colors.textMuted }}>{r.experiment}</Td>
            </Tr>
          )}
          <LambdaRow row={r} colors={colors} />
        </Fragment>
      ))}
    </>
  );
}

function LambdaRow({ row, colors }: { row: LambdaRowView; colors: ThemeColors }) {
  const tone = row.meaningful ? colors.text : colors.textMuted;
  return (
    <Tr>
      <Td style={{ color: tone }}>
        {row.p}
      </Td>
      <Td numeric style={{ color: tone, fontWeight: row.meaningful ? 600 : 400 }}>{row.lambda}</Td>
      <Td numeric style={{ color: tone }}>{row.ci ?? '—'}</Td>
      <Td numeric style={{ color: tone }}>{row.rSquared}</Td>
      <Td>
        {row.flags.length > 0 && (
          <IconButton
            size="sm"
            className="qec-lambda-warn"
            aria-label={`Warnings: ${row.flags.join('; ')}`}
            tooltip={{ label: row.flags.join('\n'), placement: 'below' }}
            style={{ color: colors.warning }}
          >
            <TriangleAlert size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </IconButton>
        )}
      </Td>
    </Tr>
  );
}
