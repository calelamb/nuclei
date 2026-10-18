import { useMemo } from 'react';
import { ChartFrame, LabCallout, LabCard, LabEmptyState, formatPct } from '../../lab';
import { guardrailPassRates, isolationNote, isolationUsed, rejectionReasons, type GuardrailPassRate, type RejectionReason } from '../../../services/discovery/guardrailStats';
import { SANDBOX_HONESTY } from '../../../services/discovery/honesty';
import { candidateList, type RunView } from '../../../services/discovery/runView';
import { ExploitsFoundLane } from '../ExploitsFoundLane';
import type { DiscoveryExploit } from '../../../types/discovery';

function ReasonsChart({ reasons }: { reasons: RejectionReason[] }) {
  const n = reasons.length;
  const max = Math.max(...reasons.map((r) => r.count));
  const xSpec = useMemo(() => ({ domain: [0, Math.max(1, max)] as [number, number], nice: false, tickValues: max <= 8 ? Array.from({ length: max + 1 }, (_, i) => i) : undefined, format: (v: number) => String(Math.round(v)), label: 'Rejected candidates' }), [max]);
  const ySpec = useMemo(() => ({ domain: [-0.5, n - 0.5] as [number, number], nice: false, tickValues: Array.from({ length: n }, (_, i) => i), format: (v: number) => { const r = reasons[n - 1 - Math.round(v)]; return r ? (r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label) : ''; } }), [n, reasons]);
  return (
    <ChartFrame
      x={xSpec}
      y={ySpec}
      height={Math.max(120, n * 34 + 50)}
      margin={{ left: 170 }}
      ariaLabel="Rejections by guardrail"
      summary={`Rejections by guardrail: ${reasons.map((r) => `${r.label} ${r.count}`).join(', ')}.`}
    >
      {({ x, y }) => (
        <g>
          {reasons.map((r, i) => {
            const slot = n - 1 - i;
            return <rect key={r.guardrail} x={0} y={y(slot + 0.32)} width={Math.max(2, x(r.count))} height={Math.max(4, y(slot - 0.32) - y(slot + 0.32))} rx={2} fill="var(--color-danger)" fillOpacity={0.85} />;
          })}
        </g>
      )}
    </ChartFrame>
  );
}

function PassRateRow({ row }: { row: GuardrailPassRate }) {
  const ran = row.pass + row.warn + row.fail;
  return (
    <tr>
      <td>{row.label}<div className="lab-mono lab-dim">{row.id}</div></td>
      <td className="lab-num">{formatPct(row.passRate, 0)}</td>
      <td style={{ minWidth: 120 }}>
        <div className="disc-bar" role="img" aria-label={`${row.pass} passed, ${row.warn} warned, ${row.fail} failed, ${row.skipped} skipped`}>
          {ran > 0 && <span style={{ flexGrow: row.pass, background: 'var(--color-success)' }} />}
          {row.warn > 0 && <span style={{ flexGrow: row.warn, background: 'var(--color-warning)' }} />}
          {row.fail > 0 && <span style={{ flexGrow: row.fail, background: 'var(--color-danger)' }} />}
        </div>
      </td>
      <td className="lab-num">{row.pass}</td>
      <td className="lab-num">{row.warn}</td>
      <td className="lab-num">{row.fail}</td>
      <td className="lab-num">{row.skipped}</td>
    </tr>
  );
}

/** The reward-hacking log: why candidates were rejected, guardrail pass rates, and the isolation actually used. */
export function GuardrailsTab({ view, onOpen, exploits }: { view: RunView; onOpen: (id: string) => void; exploits?: readonly DiscoveryExploit[] }) {
  const list = useMemo(() => candidateList(view), [view]);
  const reasons = useMemo(() => rejectionReasons(list), [list]);
  const rates = useMemo(() => guardrailPassRates(list), [list]);
  const isolation = useMemo(() => isolationUsed(list), [list]);
  return (
    <div className="disc-tabpanel">
      <div className="disc-two-col">
        <LabCard title="Rejection reasons" subtitle="Every rejection names the guardrail that stopped it">
          {reasons.length === 0 ? (
            <LabEmptyState compact title="No rejections" body="No candidate has been rejected by a guardrail in this run." />
          ) : (
            <div className="lab-stack">
              <ReasonsChart reasons={reasons} />
              <ul aria-label="Rejection reasons" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
                {reasons.map((r) => (
                  <li key={r.guardrail}>
                    <div><strong>{r.label}</strong> <span className="lab-mono lab-muted">{r.count}×</span></div>
                    <div className="lab-muted" style={{ fontSize: 12 }}>{r.message}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {r.candidateIds.map((id) => (
                        <button key={id} type="button" className="lab-button lab-button--sm lab-mono" onClick={() => onOpen(id)} aria-label={`Open ${id}, rejected by ${r.label}`}>{id}</button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </LabCard>
        <LabCard title="Isolation" subtitle="What the candidate sandbox actually did in this run">
          <div className="lab-stack">
            {isolation.length === 0 ? (
              <LabEmptyState compact title="No evaluations yet" body="The isolation mode is recorded with every evaluation." />
            ) : (
              <ul aria-label="Isolation modes used" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
                {isolation.map(({ mode, count }) => (
                  <li key={mode}>
                    <strong className="lab-mono">{mode}</strong> <span className="lab-muted">· {count} evaluation{count === 1 ? '' : 's'}</span>
                    <div className="lab-muted" style={{ fontSize: 12 }}>{isolationNote(mode)}</div>
                  </li>
                ))}
              </ul>
            )}
            <LabCallout tone="warning" title="File reads are not blocked">
              {SANDBOX_HONESTY} Candidates run in a separate subprocess, but a candidate can still read files the app can read. The trusted scorer never runs in the candidate's process.
            </LabCallout>
          </div>
        </LabCard>
      </div>

      <LabCard title="Pass rates per guardrail" subtitle="Skipped checks (after a first failure) are not counted" flush>
        {rates.length === 0 ? (
          <LabEmptyState compact title="No guardrail results yet" />
        ) : (
          <table className="lab-table" aria-label="Guardrail pass rates">
            <thead>
              <tr><th>Guardrail</th><th className="lab-num">Pass rate</th><th>Outcomes</th><th className="lab-num">Pass</th><th className="lab-num">Warn</th><th className="lab-num">Fail</th><th className="lab-num">Skipped</th></tr>
            </thead>
            <tbody>{rates.map((row) => <PassRateRow key={row.id} row={row} />)}</tbody>
          </table>
        )}
      </LabCard>

      <ExploitsFoundLane exploits={exploits} onSelectCandidate={onOpen} />
    </div>
  );
}
