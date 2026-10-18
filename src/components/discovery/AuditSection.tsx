import { CheckCircle2, CircleSlash, MinusCircle, XCircle } from 'lucide-react';
import { LabCallout, formatDuration, formatSci } from '../lab';
import { auditStatus } from '../../services/discovery/redQueen';
import type { AuditCheck, CandidateRecord, DiscoveryAudit, GuardrailStatus } from '../../types/discovery';
import { Facts, Section } from './drawerSections';
import { AuditVerdictPill } from './pills';

const CHECK_ICON: Record<GuardrailStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  pass: { icon: CheckCircle2, color: 'var(--color-success)', label: 'Passed' },
  fail: { icon: XCircle, color: 'var(--color-danger)', label: 'Failed' },
  warn: { icon: MinusCircle, color: 'var(--color-warning)', label: 'Warning' },
  skipped: { icon: CircleSlash, color: 'var(--color-text-tertiary)', label: 'Skipped' },
};

export function AuditChecks({ checks }: { checks: readonly AuditCheck[] }) {
  if (checks.length === 0) return <p className="lab-muted" style={{ margin: 0 }}>The audit recorded no individual checks.</p>;
  return (
    <ul aria-label="Audit checks" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {checks.map((c) => {
        const { icon: Icon, color, label } = CHECK_ICON[c.status];
        return (
          <li key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Icon size={14} aria-hidden style={{ color, marginTop: 2, flexShrink: 0 }} />
            <span>
              <strong>{c.label}</strong>
              <span className="lab-dim"> · {label}</span>
              {c.detail && <div className="lab-muted" style={{ fontSize: 12 }}>{c.detail}</div>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function fitness(value: number | null): string {
  return value === null ? '—' : formatSci(value, 4);
}

function Fingerprint({ value }: { value: string }) {
  return <code className="lab-mono" title={value}>{value ? `${value.slice(0, 16)}…` : '—'}</code>;
}

function AuditBody({ audit }: { audit: DiscoveryAudit }) {
  const t = audit.timings_ms;
  return (
    <>
      {audit.verdict === 'exploit' && (
        <LabCallout tone="danger" title="The audit rejects what the evaluator scored well">
          Evaluator fitness {fitness(audit.evaluator_fitness)} against audit fitness {fitness(audit.audit_fitness)}. This is an evaluator hole to fix, and it can be exported as a regression fixture.
        </LabCallout>
      )}
      <Facts
        rows={[
          ['Evaluator fitness', <span key="e" className="lab-mono">{fitness(audit.evaluator_fitness)}</span>],
          ['Audit fitness', <span key="a" className="lab-mono">{fitness(audit.audit_fitness)}</span>],
          ['Gap', <span key="g" className="lab-mono">{fitness(audit.gap)}</span>],
          ['Audit seed', audit.seed],
          ['Evaluator', `${audit.evaluator.kind} ${audit.evaluator.version}`],
          ['Isolation', audit.isolation],
          ['Evaluator fingerprint', <Fingerprint key="ef" value={audit.evaluator.fingerprint} />],
          ['Audit fingerprint', <Fingerprint key="af" value={audit.audit_fingerprint} />],
          ['Sandbox time', t.sandbox === undefined ? '—' : formatDuration(t.sandbox)],
          ['Audit time', t.audit === undefined ? '—' : formatDuration(t.audit)],
          ['Total time', formatDuration(t.total)],
        ]}
      />
      {audit.reasons.length > 0 && (
        <div>
          <span className="lab-dim">Reasons</span>
          <ul aria-label="Audit reasons" style={{ margin: '2px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
            {audit.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      <AuditChecks checks={audit.checks} />
      {audit.notes?.length ? <p className="lab-muted" style={{ margin: 0 }}>{audit.notes.join(' ')}</p> : null}
    </>
  );
}

/** Drawer section for the independent audit of a candidate, in each of its states. */
export function AuditSection({ candidate, running }: { candidate: CandidateRecord; running?: boolean }) {
  const status = running ? 'pending' : auditStatus(candidate);
  return (
    <Section title="Audit">
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <AuditVerdictPill status={status} />
        {status === 'pending' && <span className="lab-muted">Waiting for the kernel's independent audit…</span>}
      </div>
      {status === 'none' && (
        <p className="lab-muted" style={{ margin: 0 }}>
          An audit re-scores this program with a stricter, slower pass and checks that the evaluator's score holds up. Use Run audit to request one.
        </p>
      )}
      {status === 'error' && <LabCallout tone="warning" title="The audit did not finish">{candidate.audit_error}</LabCallout>}
      {candidate.audit && <AuditBody audit={candidate.audit} />}
    </Section>
  );
}
