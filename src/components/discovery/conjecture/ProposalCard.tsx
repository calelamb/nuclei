import { useState } from 'react';
import { Check, FlaskConical, Pencil, RotateCcw, Square, X } from 'lucide-react';
import { LabButton, LabCallout, LabCard, LabPill, LabProgress } from '../../lab';
import { familyText, predicateClauses, predicateMode, predictionText } from '../../../services/conjecture/describe';
import { isActiveJob, type Proposal, type TestJob } from '../../../services/conjecture/state';
import { useConjectureStore } from '../../../stores/conjectureStore';
import type { ConjectureSchemaInfo } from '../../../types/conjecture';
import { EvidenceList } from './EvidenceList';
import { ProposalEditor } from './ProposalEditor';
import { VerdictCard } from './VerdictCard';

const DECISION_TONE = { draft: 'neutral', accepted: 'quantum', rejected: 'danger' } as const;
const DECISION_LABEL = { draft: 'Draft', accepted: 'Accepted', rejected: 'Rejected' } as const;

export function ProposalCard({ runId, proposal, job, schema, anyTestActive }: {
  runId: string;
  proposal: Proposal;
  job: TestJob | undefined;
  schema: ConjectureSchemaInfo | null;
  anyTestActive: boolean;
}) {
  const { conjecture: c } = proposal;
  const { test, cancel, decide, editDraft } = useConjectureStore.getState();
  const [editing, setEditing] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const active = isActiveJob(job);
  const rejected = proposal.decision === 'rejected';
  const clauses = predicateClauses(c.feature_predicate);
  const mode = predicateMode(c.feature_predicate) === 'all' ? 'All of' : 'Any of';

  const run = async () => {
    setStartError(null);
    const res = await test(runId, c.id);
    if (!res.ok) setStartError(res.error);
  };
  const testBlocked = rejected || active || anyTestActive;
  const blockedReason = rejected
    ? 'Restore the proposal to test it.'
    : active
      ? 'This conjecture is being tested now.'
      : anyTestActive
        ? 'Another conjecture is being tested.'
        : null;

  return (
    <LabCard
      title={<span className="lab-mono">{c.id}</span>}
      aria-label={`Conjecture ${c.id}`}
      actions={
        <>
          {proposal.edited && <LabPill outline>Edited</LabPill>}
          <LabPill tone={DECISION_TONE[proposal.decision]} dot>{DECISION_LABEL[proposal.decision]}</LabPill>
        </>
      }
    >
      <div className="cj-stack">
        {editing && schema ? (
          <ProposalEditor
            conjecture={c}
            schema={schema}
            onCancel={() => setEditing(false)}
            onSave={(next) => {
              const res = editDraft(runId, c.id, next);
              if (res.ok) setEditing(false);
              return res.ok ? { ok: true } : { ok: false, error: res.error, issues: res.issues };
            }}
          />
        ) : (
          <>
            <p className="cj-statement">{c.statement}</p>
            <ul className="cj-chips" aria-label={`${mode} these structural conditions hold`}>
              <li className="lab-muted" style={{ fontSize: 11, alignSelf: 'center' }}>{mode}</li>
              {clauses.map((text) => <li key={text} className="cj-chip">{text}</li>)}
              <li className="lab-muted" style={{ fontSize: 11, alignSelf: 'center' }}>predict</li>
              <li className="cj-chip cj-chip--prediction">{predictionText(c.prediction)}</li>
            </ul>
            <dl className="cj-meta">
              <dt>Test family</dt><dd>{familyText(c.test_family)}</dd>
              <dt>n range</dt><dd>{c.n_range[0]} to {c.n_range[1]} qubits, {c.points} points</dd>
              <dt>Held-out circuits</dt><dd>{c.circuits}</dd>
            </dl>
          </>
        )}
        {!editing && (
          <div className="cj-actions">
            <LabButton variant="primary" icon={FlaskConical} disabled={testBlocked} title={blockedReason ?? undefined} onClick={() => void run()}>
              {job && !active ? 'Test again' : 'Test'}
            </LabButton>
            {blockedReason && !active && <span className="lab-muted" style={{ fontSize: 12 }} data-testid="test-blocked-reason">{blockedReason}</span>}
            {active && <LabButton icon={Square} disabled={job?.status === 'cancelling'} onClick={() => void cancel(runId, c.id)}>{job?.status === 'cancelling' ? 'Cancelling' : 'Cancel'}</LabButton>}
            {!active && proposal.decision !== 'accepted' && !rejected && <LabButton icon={Check} onClick={() => decide(runId, c.id, 'accepted')}>Accept</LabButton>}
            {!active && !rejected && <LabButton variant="ghost" icon={X} onClick={() => decide(runId, c.id, 'rejected')}>Reject</LabButton>}
            {!active && rejected && <LabButton variant="ghost" icon={RotateCcw} onClick={() => decide(runId, c.id, 'draft')}>Restore</LabButton>}
            {!active && schema && !rejected && <LabButton variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Edit</LabButton>}
          </div>
        )}
        {startError && <LabCallout tone="danger" title="Could not start the test">{startError}</LabCallout>}
        {job && active && (
          <div className="lab-stack" style={{ gap: 'var(--space-2)' }} role="status" aria-live="polite">
            <LabProgress value={job.status === 'starting' ? null : job.fraction} label={`Testing ${c.id}`} />
            <span className="lab-muted" style={{ fontSize: 12 }}>
              {job.message} · {job.evidence.length} of {c.circuits} circuits
            </span>
          </div>
        )}
        {job && !active && job.error && <LabCallout tone="danger" title={job.status === 'cancelled' ? 'Cancelled' : 'The test did not finish'}>{job.error.message}</LabCallout>}
        {job && job.status === 'cancelled' && <LabCallout tone="info">Cancelled before a verdict. Nothing was written to the ledger.</LabCallout>}
        {job && active && <EvidenceList rows={job.evidence} expected={c.circuits} />}
        {job && !active && job.result && (
          <VerdictCard runId={runId} conjecture={c} result={job.result} rows={job.evidence.length > 0 ? job.evidence : undefined} ledgerError={job.ledgerError} />
        )}
      </div>
    </LabCard>
  );
}
