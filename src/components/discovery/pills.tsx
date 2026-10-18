import { LabPill, type LabTone } from '../lab';
import { CANDIDATE_KIND_LABEL, type CandidateKind } from '../../services/discovery/candidateView';
import { EVALUATOR_TITLE, mutatorLabel } from '../../services/discovery/format';
import type { AuditStatus } from '../../services/discovery/redQueen';
import type { DiscoveryEvaluatorKind, ModelTier, MutatorKind, RunStatus } from '../../types/discovery';

const RUN_TONE: Record<RunStatus, LabTone> = {
  running: 'quantum',
  paused: 'warning',
  completed: 'success',
  stopped: 'neutral',
  failed: 'danger',
  stale: 'warning',
};

const RUN_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  stopped: 'Stopped',
  failed: 'Failed',
  stale: 'Stale',
};

const RUN_HINT: Partial<Record<RunStatus, string>> = {
  stale: 'The app closed while this run was active. Resume it to continue from the saved state.',
};

export function RunStatusPill({ status }: { status: RunStatus }) {
  return (
    <LabPill tone={RUN_TONE[status]} live={status === 'running'} dot={status !== 'running'} title={RUN_HINT[status]}>
      {RUN_LABEL[status]}
    </LabPill>
  );
}

const KIND_TONE: Record<CandidateKind, LabTone> = {
  seed: 'neutral',
  scored: 'success',
  rejected: 'danger',
  failed: 'warning',
  screened_out: 'neutral',
  duplicate: 'neutral',
  invalid: 'warning',
  pending: 'quantum',
};

export function CandidateKindPill({ kind }: { kind: CandidateKind }) {
  return (
    <LabPill tone={KIND_TONE[kind]} dot outline={kind === 'screened_out' || kind === 'duplicate' || kind === 'seed'}>
      {CANDIDATE_KIND_LABEL[kind]}
    </LabPill>
  );
}

export function EvaluatorChip({ kind }: { kind: DiscoveryEvaluatorKind }) {
  return (
    <LabPill tone="dirac" outline title="Trusted evaluator">
      {EVALUATOR_TITLE[kind]}
    </LabPill>
  );
}

export function MutatorChip({ kind, breadth, depth }: { kind: MutatorKind; breadth: ModelTier; depth: ModelTier }) {
  if (kind === 'red_queen') {
    return (
      <LabPill tone="danger" dot title="Red Queen mode: an LLM adversary tries to find programs the evaluator scores well but an independent audit rejects. Security testing of our own evaluator.">
        Red Queen
      </LabPill>
    );
  }
  return (
    <LabPill tone="neutral" outline title="Mutator and model ensemble (breadth / depth)">
      {mutatorLabel(kind, breadth, depth)}
    </LabPill>
  );
}

const AUDIT_TONE: Record<AuditStatus, LabTone> = {
  none: 'neutral',
  pending: 'quantum',
  consistent: 'success',
  exploit: 'danger',
  inconclusive: 'warning',
  error: 'warning',
};

const AUDIT_LABEL: Record<AuditStatus, string> = {
  none: 'Not audited',
  pending: 'Audit pending',
  consistent: 'Consistent',
  exploit: 'Exploit',
  inconclusive: 'Inconclusive',
  error: 'Audit failed',
};

const AUDIT_HINT: Record<AuditStatus, string> = {
  none: 'No independent audit has been run for this candidate.',
  pending: 'The audit was sent to the kernel and has not answered yet.',
  consistent: 'The independent audit agrees with the evaluator.',
  exploit: 'The evaluator scored this program well, but the independent audit rejects it.',
  inconclusive: 'The audit could not decide: treat the score as unverified.',
  error: 'The audit request failed; see the candidate for the reason.',
};

/** Verdict of an independent audit (addendum §F). */
export function AuditVerdictPill({ status }: { status: AuditStatus }) {
  return (
    <LabPill tone={AUDIT_TONE[status]} dot live={status === 'pending'} outline={status === 'none'} title={AUDIT_HINT[status]}>
      {AUDIT_LABEL[status]}
    </LabPill>
  );
}
