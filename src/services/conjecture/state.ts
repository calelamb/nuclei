/** Pure state shapes and reducers for the conjecture store (immutable updates). */

import type { Conjecture, ConjectureResult, EvidenceRow, LedgerFile, ProposerMeta } from '../../types/conjecture';
import type { DroppedConjecture } from './proposer';
import type { TesterError } from './tester';

type ProposalDecision = 'draft' | 'accepted' | 'rejected';

export interface Proposal {
  conjecture: Conjecture;
  decision: ProposalDecision;
  meta: ProposerMeta | null;
  edited: boolean;
}

export type JobStatus = 'starting' | 'running' | 'cancelling' | 'complete' | 'cancelled' | 'failed';
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['starting', 'running', 'cancelling'];

export interface TestJob {
  jobId: string;
  conjectureId: string;
  status: JobStatus;
  fraction: number;
  message: string;
  circuitIndex: number | null;
  evidence: EvidenceRow[];
  result: ConjectureResult | null;
  error: TesterError | null;
  seed: number;
  startedAt: string;
  /** Set when the result could not be written to the ledger. */
  ledgerError: string | null;
}

export interface LedgerState {
  ledger: LedgerFile | null;
  loading: boolean;
  error: string | null;
}

export interface ProposeError {
  code: string;
  message: string;
}

export interface RunConjectures {
  proposals: Proposal[];
  proposing: boolean;
  proposeError: ProposeError | null;
  dropped: DroppedConjecture[];
  jobs: Record<string, TestJob>;
  ledger: LedgerState;
}

export const emptyRunConjectures = (): RunConjectures => ({
  proposals: [],
  proposing: false,
  proposeError: null,
  dropped: [],
  jobs: {},
  ledger: { ledger: null, loading: false, error: null },
});

export const isActiveJob = (job: TestJob | undefined): boolean => !!job && ACTIVE_JOB_STATUSES.includes(job.status);

export function patchRun(
  byRun: Record<string, RunConjectures>,
  runId: string,
  patch: (current: RunConjectures) => Partial<RunConjectures>,
): Record<string, RunConjectures> {
  const current = byRun[runId] ?? emptyRunConjectures();
  return { ...byRun, [runId]: { ...current, ...patch(current) } };
}

export function patchJob(
  byRun: Record<string, RunConjectures>,
  runId: string,
  conjectureId: string,
  patch: (job: TestJob) => Partial<TestJob>,
): Record<string, RunConjectures> {
  const current = byRun[runId];
  const job = current?.jobs[conjectureId];
  if (!current || !job) return byRun;
  return { ...byRun, [runId]: { ...current, jobs: { ...current.jobs, [conjectureId]: { ...job, ...patch(job) } } } };
}

export function patchProposal(proposals: Proposal[], conjectureId: string, patch: Partial<Proposal>): Proposal[] {
  return proposals.map((p) => (p.conjecture.id === conjectureId ? { ...p, ...patch } : p));
}

export interface ProposeBlocker {
  code: 'no_key' | 'too_few_elites' | 'run_live' | 'no_run';
  reason: string;
}

export function proposeBlocker(input: { hasKey: boolean; scoredElites: number; live: boolean; minElites: number }): ProposeBlocker | null {
  if (input.live) return { code: 'run_live', reason: 'The run is still active. Propose conjectures once it has finished or been stopped.' };
  if (input.scoredElites < input.minElites) {
    return { code: 'too_few_elites', reason: `Needs at least ${input.minElites} scored archive elites; this run has ${input.scoredElites}.` };
  }
  if (!input.hasKey) return { code: 'no_key', reason: 'Add an Anthropic API key in Settings, Dirac to propose conjectures.' };
  return null;
}

/** Proposals kept per run: the newest, plus any older one that has a test job (its ledger entry points at it). */
export const MAX_PROPOSALS = 50;

export function capProposals(proposals: Proposal[], jobs: Record<string, TestJob>, max = MAX_PROPOSALS): Proposal[] {
  if (proposals.length <= max) return proposals;
  return proposals.filter((p, i) => i < max || jobs[p.conjecture.id] !== undefined);
}
