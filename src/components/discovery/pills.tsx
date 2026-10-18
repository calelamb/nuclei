import { LabPill, type LabTone } from '../lab';
import { CANDIDATE_KIND_LABEL, type CandidateKind } from '../../services/discovery/candidateView';
import { EVALUATOR_TITLE, mutatorLabel } from '../../services/discovery/format';
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
