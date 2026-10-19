import { CheckCircle2, CircleSlash, MinusCircle, XCircle } from 'lucide-react';
import { LabCallout, LabCode, LabPill, LabSectionLabel, formatDuration, formatInterval, formatSci } from '../lab';
import { describeMethod, formatCount } from '../../services/discovery/format';
import type { CandidateRecord, DiscoveryEvaluation, GuardrailStatus } from '../../types/discovery';

const GUARDRAIL_ICON: Record<GuardrailStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  pass: { icon: CheckCircle2, color: 'var(--color-success)', label: 'Passed' },
  fail: { icon: XCircle, color: 'var(--color-danger)', label: 'Failed' },
  warn: { icon: MinusCircle, color: 'var(--color-warning)', label: 'Warning' },
  skipped: { icon: CircleSlash, color: 'var(--color-text-tertiary)', label: 'Skipped' },
};

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="lab-stack" style={{ gap: 'var(--space-2)' }}>
      <LabSectionLabel>{title}</LabSectionLabel>
      {children}
    </section>
  );
}

export function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="disc-counts" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', rowGap: 4 }}>
      {rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function GuardrailChecklist({ evaluation }: { evaluation: DiscoveryEvaluation }) {
  if (evaluation.guardrails.length === 0) return <p className="lab-muted" style={{ margin: 0 }}>No guardrail results were recorded.</p>;
  return (
    <ul aria-label="Guardrail checklist" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {evaluation.guardrails.map((g) => {
        const { icon: Icon, color, label } = GUARDRAIL_ICON[g.status];
        return (
          <li key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Icon size={14} aria-hidden style={{ color, marginTop: 2, flexShrink: 0 }} />
            <span>
              <strong>{g.label}</strong>
              <span className="lab-dim"> · {label}</span>
              {g.detail && <div className="lab-muted" style={{ fontSize: 12 }}>{g.detail}</div>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ObjectivesTable({ evaluation }: { evaluation: DiscoveryEvaluation }) {
  const entries = Object.entries(evaluation.objectives);
  if (entries.length === 0) return <p className="lab-muted" style={{ margin: 0 }}>No objectives: the candidate was not scored.</p>;
  return (
    <table className="lab-table" aria-label="Objectives">
      <thead><tr><th>Objective</th><th className="lab-num">Value</th><th>95% CI</th><th>Goal</th></tr></thead>
      <tbody>
        {entries.map(([key, o]) => (
          <tr key={key} style={{ cursor: 'default' }}>
            <td>{o.label}</td>
            <td className="lab-num">{formatSci(o.value, 4)}</td>
            <td className="lab-mono">{o.ci95 ? formatInterval(o.ci95, 3) : <span className="lab-dim">exact</span>}</td>
            <td>{o.direction}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LlmSection({ candidate }: { candidate: CandidateRecord }) {
  const llm = candidate.llm;
  if (!llm) return null;
  return (
    <Section title="LLM proposal">
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <LabPill tone="dirac" title={llm.model}>{llm.depth ? 'Depth' : 'Breadth'} · {llm.tier}</LabPill>
        <span className="lab-mono lab-muted">{llm.model}</span>
        {llm.thinking && <LabPill tone="neutral" outline>thinking</LabPill>}
        {llm.batch_id && <LabPill tone="neutral" outline>batch</LabPill>}
      </div>
      <div><span className="lab-dim">Rationale</span><p style={{ margin: '2px 0 0', lineHeight: 1.5 }}>{llm.rationale}</p></div>
      <div><span className="lab-dim">Expected effect</span><p style={{ margin: '2px 0 0', lineHeight: 1.5 }}>{llm.expected_effect}</p></div>
      <Facts
        rows={[
          ['Touched dead lines', <span key="t" title="Flagged-dead lines of the parent's gradient map that this edit changed">{llm.touched_dead_lines}</span>],
          ['Edits', llm.edits.length],
          ['Tokens in / out', llm.usage ? `${formatCount(llm.usage.input_tokens)} / ${formatCount(llm.usage.output_tokens)}` : '—'],
          ['Cache read', llm.usage ? formatCount(llm.usage.cache_read_input_tokens) : '—'],
        ]}
      />
    </Section>
  );
}

export function FailureCallouts({ candidate, evaluation }: { candidate: CandidateRecord; evaluation: DiscoveryEvaluation | null }) {
  return (
    <>
      {candidate.outcome === 'duplicate' && <LabCallout tone="info" title="Duplicate">Same normalized program as <span className="lab-mono">{candidate.duplicate_of ?? 'an earlier candidate'}</span>; it was not evaluated again.</LabCallout>}
      {candidate.outcome === 'invalid_proposal' && <LabCallout tone="warning" title="Invalid proposal">{candidate.proposal_error ?? 'The proposed edit could not be applied.'}</LabCallout>}
      {candidate.outcome === 'screened_out' && <LabCallout tone="info" title="Screened out">Its cheap screen-stage estimate did not beat the promotion bar, so it was never fully evaluated and cannot enter the archive.</LabCallout>}
      {candidate.region_warning && <LabCallout tone="warning">The edit region markers were missing; the whole file was treated as editable.</LabCallout>}
      {evaluation?.rejection && <LabCallout tone="danger" title={`Rejected by ${evaluation.rejection.guardrail}`}>{evaluation.rejection.message}</LabCallout>}
      {evaluation?.failure && <LabCallout tone="danger" title={`Failed in the ${evaluation.failure.stage} stage (${evaluation.failure.code})`}>{evaluation.failure.message}</LabCallout>}
    </>
  );
}

export function EvaluationFacts({ evaluation }: { evaluation: DiscoveryEvaluation }) {
  const t = evaluation.timings_ms;
  return (
    <Facts
      rows={[
        ['Stage', evaluation.stage ?? '—'],
        ['Cache hit', evaluation.cache_hit === undefined ? '—' : evaluation.cache_hit ? 'yes' : 'no'],
        ['Isolation', evaluation.isolation ?? 'not reported'],
        ['File reads', evaluation.isolation_detail?.reads ?? 'not reported'],
        ['Eval seed', evaluation.seed],
        ['Sandbox time', t.sandbox === undefined ? '—' : formatDuration(t.sandbox)],
        ['Score time', t.score === undefined ? '—' : formatDuration(t.score)],
        ['Total time', formatDuration(t.total)],
        ['Compute', evaluation.compute ? `${evaluation.compute.backend}${evaluation.compute.method ? `, ${describeMethod(evaluation.compute.method)}` : ''}` : '—'],
        ['Evaluator', `${evaluation.evaluator.kind} ${evaluation.evaluator.version}`],
        ['Fingerprint', <code key="f" className="lab-mono" title={evaluation.evaluator.fingerprint}>{evaluation.evaluator.fingerprint.slice(0, 16)}…</code>],
      ]}
    />
  );
}

export function OutputBlocks({ evaluation }: { evaluation: DiscoveryEvaluation }) {
  return (
    <>
      <div><span className="lab-dim">stdout</span>{evaluation.stdout ? <LabCode label="stdout" maxHeight={140}>{evaluation.stdout}</LabCode> : <p className="lab-muted" style={{ margin: '2px 0 0' }}>empty</p>}</div>
      <div><span className="lab-dim">stderr</span>{evaluation.stderr ? <LabCode label="stderr" maxHeight={140}>{evaluation.stderr}</LabCode> : <p className="lab-muted" style={{ margin: '2px 0 0' }}>empty</p>}</div>
    </>
  );
}
