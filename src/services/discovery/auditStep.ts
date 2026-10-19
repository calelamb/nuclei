/**
 * The audit step of a run (addendum §F): decide whether a freshly scored
 * candidate is audited, send `discovery_audit`, fold the verdict back into
 * the candidate record, and persist exploits. Used by Red Queen runs; the
 * same `runAudit` serves resume (re-sending pending audits) and manual audits.
 *
 * Never throws: a failed audit becomes `audit_error` plus a notice.
 */

import type { CandidateRecord, DiscoveryAudit } from '../../types/discovery';
import { eliteFromEvaluation } from './archive';
import {
  EMPTY_POLICY,
  adversarialFitness,
  auditsStarted,
  buildExploitRecord,
  exploitTitle,
  failedChecks,
  gateExploit,
  observeScored,
  type AuditPolicyState,
} from './redQueen';
import type { AuditFinding } from './redQueenPrompt';
import type { RunContext } from './runContext';

function cellKey(ctx: RunContext, c: CandidateRecord): string | null {
  if (!c.evaluation) return null;
  const elite = eliteFromEvaluation(ctx.getRun().archive, { candidateId: c.id, island: c.island, programHash: c.program_sha256 }, c.evaluation);
  return elite ? elite.cell.join(',') : null;
}

/** A candidate the audit policy may consider: scored at the full stage with a numeric fitness. */
function isAuditable(c: CandidateRecord): boolean {
  const e = c.evaluation;
  return c.outcome === 'evaluated' && e !== null && e.status === 'scored' && typeof e.fitness === 'number' && e.stage !== 'screen';
}

function findingOf(c: CandidateRecord): AuditFinding | null {
  const audit = c.audit;
  if (!audit) return null;
  return { candidateId: c.id, verdict: audit.verdict, gap: audit.gap, reasons: audit.reasons, failedChecks: failedChecks(audit).map((k) => k.label) };
}

/** Rebuild the policy state and findings from a run's candidates (resume). */
export function rebuildRedQueen(ctx: RunContext, candidates: readonly CandidateRecord[]): void {
  const rq = ctx.rq;
  if (!rq) return;
  let policy: AuditPolicyState = EMPTY_POLICY;
  const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  for (const c of ordered) {
    const cell = isAuditable(c) ? cellKey(ctx, c) : null;
    if (cell && c.evaluation && typeof c.evaluation.fitness === 'number') {
      policy = observeScored(policy, rq.config, c.evaluation.fitness, cell).state;
    }
  }
  const findings = ordered.map(findingOf).filter((f): f is AuditFinding => f !== null);
  ctx.rq = { ...rq, policy, findings, started: auditsStarted(ordered) };
}

/** Observe the seed (never audited) so improvement is measured against it. */
export function observeSeed(ctx: RunContext, seed: CandidateRecord): void {
  const rq = ctx.rq;
  if (!rq || !isAuditable(seed) || !seed.evaluation || typeof seed.evaluation.fitness !== 'number') return;
  const cell = cellKey(ctx, seed);
  if (cell) ctx.rq = { ...rq, policy: observeScored(rq.policy, rq.config, seed.evaluation.fitness, cell).state };
}

/** Audit `candidate` now. Resolves with the updated (and saved) record; unchanged when cancelled. */
export async function runAudit(ctx: RunContext, candidate: CandidateRecord): Promise<CandidateRecord> {
  const evaluation = candidate.evaluation;
  if (!evaluation) return candidate;
  const { spec, runId } = ctx;
  await ctx.control.gate();
  if (ctx.control.stopped) return candidate;
  ctx.activity(candidate.id, 'evaluating');
  const outcome = await ctx.evalLimit(async () => {
    if (ctx.control.stopped) return { status: 'cancelled' as const };
    return ctx.audits.audit({
      runId, candidateId: candidate.id, evaluator: { kind: spec.evaluator.kind, config: spec.evaluator.config },
      program: candidate.program, entry: spec.entry, seed: candidate.eval_seed, evaluation,
    });
  });
  ctx.activity(candidate.id, 'idle');
  if (outcome.status === 'cancelled') return candidate;
  if (outcome.status === 'error') {
    ctx.notice(`Audit of ${candidate.id} failed (${outcome.code}): ${outcome.message}`);
    const failed = { ...candidate, audit_pending: false, audit_error: `${outcome.code}: ${outcome.message}`, adversarial_fitness: 0 };
    ctx.saveCandidate(failed);
    return failed;
  }
  return recordAudit(ctx, candidate, outcome.audit);
}

function recordAudit(ctx: RunContext, candidate: CandidateRecord, rawAudit: DiscoveryAudit): CandidateRecord {
  const audit = gateExploit(rawAudit, candidate.evaluation?.fitness, ctx.getRun().seed_fitness);
  if (audit !== rawAudit) ctx.notice(`Audit of ${candidate.id} failed but is not an exploit: ${audit.reasons[0]}`);
  const done: CandidateRecord = { ...candidate, audit, audit_pending: false, audit_error: null, adversarial_fitness: adversarialFitness(audit) };
  ctx.saveCandidate(done);
  const finding = findingOf(done);
  if (ctx.rq && finding) ctx.rq = { ...ctx.rq, findings: [...ctx.rq.findings, finding] };
  if (audit.verdict === 'exploit') {
    ctx.persister.writeExploit(done.id, buildExploitRecord(ctx.spec, ctx.runId, done, audit, ctx.rq ? 'red_queen' : 'manual_audit'));
    ctx.notice(`Exploit found in ${done.id}: ${exploitTitle(done.id, audit)}`);
  }
  return done;
}

/** Apply the audit policy to a just-evaluated candidate and audit it when due. */
export async function auditIfDue(ctx: RunContext, candidate: CandidateRecord): Promise<CandidateRecord> {
  const rq = ctx.rq;
  if (!rq || !isAuditable(candidate) || !candidate.evaluation || typeof candidate.evaluation.fitness !== 'number') return candidate;
  const cell = cellKey(ctx, candidate);
  if (!cell) return candidate;
  const observed = observeScored(rq.policy, rq.config, candidate.evaluation.fitness, cell);
  ctx.rq = { ...rq, policy: observed.state };
  if (!observed.audit) return candidate;
  if (rq.started >= rq.config.max_audits) {
    ctx.notice(`Audit budget used up (${rq.config.max_audits} audits): later candidates are scored but not audited.`);
    return candidate;
  }
  ctx.rq = { ...(ctx.rq as typeof rq), started: rq.started + 1 };
  const pending = { ...candidate, audit_pending: true, audit_error: null };
  ctx.saveCandidate(pending);
  return runAudit(ctx, pending);
}

/** Candidates whose audit was sent but never answered (stop, crash): they are sent again on resume. */
export function pendingAudits(candidates: Iterable<CandidateRecord>): CandidateRecord[] {
  return [...candidates].filter((c) => c.audit_pending === true && !c.audit && c.evaluation !== null).sort((a, b) => a.id.localeCompare(b.id));
}
