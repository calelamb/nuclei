/**
 * Red Queen mode (addendum §F), pure parts: configuration, the adversarial
 * fitness, the "which candidates get audited" policy and the exploit
 * records. Nothing here does I/O.
 *
 * Fitness definition (kept deliberately simple):
 *
 *   adversarial fitness = max(0, evaluator fitness - audit fitness)        (verdict consistent/inconclusive)
 *                       = EXPLOIT_BONUS + max(0, gap)                      (verdict exploit)
 *                       = 0                                                (not audited, or the audit failed)
 *
 * The gap rewards candidates the evaluator likes and the audit does not. An
 * exploit verdict dominates any gap so a confirmed bypass always outranks a
 * merely suspicious one. The archive stores this number in Red Queen mode only.
 */

import type {
  AuditCheck,
  CandidateRecord,
  DiscoveryAudit,
  DiscoveryExploit,
  DiscoverySpec,
  ExploitFixture,
  ExploitRecord,
  RedQueenConfig,
} from '../../types/discovery';

export const EXPLOIT_BONUS = 1000;
export const DEFAULT_RED_QUEEN: RedQueenConfig = { audit_every: 'improvement', top_k: 5, max_audits: 50 };
export const NO_EXPLOIT_MESSAGE = 'no exploit found within budget — evidence, not proof, of robustness';

export function isRedQueen(spec: Pick<DiscoverySpec, 'mutator'>): boolean {
  return spec.mutator.kind === 'red_queen';
}

export function redQueenConfig(spec: Pick<DiscoverySpec, 'red_queen'>): RedQueenConfig {
  return { ...DEFAULT_RED_QUEEN, ...(spec.red_queen ?? {}) };
}

export function adversarialFitness(audit: DiscoveryAudit | null | undefined): number {
  if (!audit) return 0;
  const gap = typeof audit.gap === 'number' && Number.isFinite(audit.gap) ? Math.max(0, audit.gap) : 0;
  return audit.verdict === 'exploit' ? EXPLOIT_BONUS + gap : gap;
}

// ── Which candidates get audited ───────────────────────────────────────

export interface AuditPolicyState {
  bestFitness: number | null;
  /** Archive cells (`"col,row"` of the primary descriptors) seen so far. */
  cells: ReadonlySet<string>;
  /** Evaluator fitnesses seen so far, descending (for `top_k`). */
  fitnesses: readonly number[];
}

export const EMPTY_POLICY: AuditPolicyState = { bestFitness: null, cells: new Set(), fitnesses: [] };

/**
 * Observe one scored candidate. Returns the next state and whether the policy
 * asks for an audit. `improvement` = a new best evaluator fitness or a cell no
 * earlier candidate occupied; `top_k` = among the k best evaluator fitnesses so far.
 */
export function observeScored(
  state: AuditPolicyState,
  config: Pick<RedQueenConfig, 'audit_every' | 'top_k'>,
  fitness: number,
  cell: string,
): { state: AuditPolicyState; audit: boolean } {
  const newBest = state.bestFitness === null || fitness > state.bestFitness;
  const newCell = !state.cells.has(cell);
  const fitnesses = [...state.fitnesses, fitness].sort((a, b) => b - a);
  const next: AuditPolicyState = {
    bestFitness: newBest ? fitness : state.bestFitness,
    cells: newCell ? new Set([...state.cells, cell]) : state.cells,
    fitnesses,
  };
  const audit =
    config.audit_every === 'all' ||
    (config.audit_every === 'improvement' && (newBest || newCell)) ||
    (config.audit_every === 'top_k' && fitnesses.indexOf(fitness) < config.top_k);
  return { state: next, audit };
}

// ── Exploits ───────────────────────────────────────────────────────────

export function exploitId(runId: string, candidateId: string): string {
  return `rq-${runId}-${candidateId}`;
}

export function failedChecks(audit: DiscoveryAudit): AuditCheck[] {
  return audit.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
}

export function auditNotes(audit: DiscoveryAudit): string {
  const reasons = audit.reasons.length > 0 ? ` Reasons: ${audit.reasons.join('; ')}.` : '';
  const gap = audit.gap === null ? 'unknown' : String(audit.gap);
  return `Audit verdict ${audit.verdict}: evaluator fitness ${audit.evaluator_fitness ?? 'n/a'}, audit fitness ${audit.audit_fitness ?? 'n/a'}, gap ${gap}.${reasons}${audit.notes?.length ? ` ${audit.notes.join(' ')}` : ''}`;
}

export function exploitTitle(candidateId: string, audit: DiscoveryAudit): string {
  const why = audit.reasons[0] ?? failedChecks(audit)[0]?.label ?? 'audit rejected a program the evaluator scored well';
  return `Candidate ${candidateId}: ${why}`;
}

export type DiscoveredBy = ExploitFixture['discovered_by'];

export function buildExploitRecord(
  spec: DiscoverySpec,
  runId: string,
  candidate: CandidateRecord,
  audit: DiscoveryAudit,
  discoveredBy: DiscoveredBy,
): ExploitRecord {
  return {
    id: exploitId(runId, candidate.id),
    title: exploitTitle(candidate.id, audit),
    evaluator: { kind: spec.evaluator.kind, config: spec.evaluator.config },
    program: candidate.program,
    entry: spec.entry,
    seed: candidate.eval_seed,
    stage: candidate.evaluation?.stage ?? 'full',
    discovered_by: discoveredBy,
    expect: 'audit_exploit',
    notes: auditNotes(audit),
    audit,
  };
}

/** The kernel regression fixture: the exploit record without the audit (its summary stays in `notes`). */
export function toKernelFixture(record: ExploitRecord): ExploitFixture {
  const { audit: _audit, ...fixture } = record;
  void _audit;
  return fixture;
}

/** Exploits recorded on a run's candidates, in candidate order. */
export function exploitsOf(runId: string, candidates: readonly CandidateRecord[], spec: DiscoverySpec): DiscoveryExploit[] {
  return candidates.flatMap((c) => {
    const audit = c.audit;
    if (!audit || audit.verdict !== 'exploit') return [];
    return [{
      id: exploitId(runId, c.id),
      candidateId: c.id,
      title: exploitTitle(c.id, audit),
      gap: audit.gap,
      evaluatorFitness: audit.evaluator_fitness,
      auditFitness: audit.audit_fitness,
      failedChecks: failedChecks(audit),
      reasons: audit.reasons,
      audit,
      discoveredBy: isRedQueen(spec) ? 'red_queen' : 'manual_audit',
    }];
  });
}

// ── Audit status and summary ───────────────────────────────────────────

export type AuditStatus = 'none' | 'pending' | 'consistent' | 'exploit' | 'inconclusive' | 'error';

export function auditStatus(c: Pick<CandidateRecord, 'audit' | 'audit_pending' | 'audit_error'>): AuditStatus {
  if (c.audit) return c.audit.verdict;
  if (c.audit_pending) return 'pending';
  return c.audit_error ? 'error' : 'none';
}

export interface AuditSummary {
  run: number;
  pending: number;
  consistent: number;
  inconclusive: number;
  exploits: number;
  errors: number;
  /** Largest evaluator-minus-audit gap seen, or null. */
  maxGap: number | null;
}

export function summarizeAudits(candidates: readonly CandidateRecord[]): AuditSummary {
  const out = { run: 0, pending: 0, consistent: 0, inconclusive: 0, exploits: 0, errors: 0, maxGap: null as number | null };
  for (const c of candidates) {
    const status = auditStatus(c);
    if (status === 'none') continue;
    if (status === 'pending') out.pending += 1;
    else if (status === 'error') out.errors += 1;
    else {
      out.run += 1;
      if (status === 'consistent') out.consistent += 1;
      else if (status === 'inconclusive') out.inconclusive += 1;
      else out.exploits += 1;
      const gap = c.audit?.gap;
      if (typeof gap === 'number' && (out.maxGap === null || gap > out.maxGap)) out.maxGap = gap;
    }
  }
  return out;
}

/** Audits already sent for a run (done or pending), against `max_audits`. */
export function auditsStarted(candidates: Iterable<CandidateRecord>): number {
  let n = 0;
  for (const c of candidates) if (c.audit || c.audit_pending || c.audit_error) n += 1;
  return n;
}
