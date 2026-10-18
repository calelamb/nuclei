/**
 * Audit actions that work from disk state, outside a live run: audit one
 * candidate on demand (available in any mode) and export an exploit as a
 * kernel regression fixture.
 */

import type { CandidateRecord, DiscoveryAudit, DiscoverySpec, ExploitRecord } from '../../types/discovery';
import { createAuditClient } from './kernelAudit';
import { adversarialFitness, buildExploitRecord, gateExploit, isRedQueen, toKernelFixture } from './redQueen';
import { loadCandidates, runPaths, toJson, type DiscoveryFs, type JoinFn } from './records';
import type { DiscoveryDeps, DiscoveryRunContext } from './runContext';

export type AuditActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Where the kernel's pytest replays exploit fixtures (addendum §F). */
export const KERNEL_EXPLOIT_DIR = ['kernel', 'tests', 'fixtures', 'exploits'] as const;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Audit one scored candidate of a stored run and write the verdict back to its candidate file. */
export async function auditStoredCandidate(
  spec: DiscoverySpec,
  rctx: DiscoveryRunContext,
  deps: DiscoveryDeps,
  runId: string,
  candidateId: string,
): Promise<AuditActionResult<{ candidate: CandidateRecord; audit: DiscoveryAudit }>> {
  const paths = runPaths(deps.join, rctx.projectRoot, rctx.definitionFile, runId);
  const { candidates } = await loadCandidates(deps.fs, paths);
  const candidate = candidates.find((c) => c.id === candidateId);
  if (!candidate) return { ok: false, error: `Candidate ${candidateId} was not found on disk.` };
  if (!candidate.evaluation || candidate.evaluation.status !== 'scored') {
    return { ok: false, error: 'Only scored candidates can be audited: the audit re-checks a score.' };
  }
  const client = createAuditClient({ session: deps.session, sleep: deps.clock.sleep });
  try {
    const outcome = await client.audit({
      runId, candidateId, evaluator: { kind: spec.evaluator.kind, config: spec.evaluator.config },
      program: candidate.program, entry: spec.entry, seed: candidate.eval_seed, evaluation: candidate.evaluation,
    });
    if (outcome.status === 'cancelled') return { ok: false, error: 'The audit was cancelled.' };
    if (outcome.status === 'error') return { ok: false, error: `${outcome.code}: ${outcome.message}` };
    // Below the honest seed's fitness a failing audit is an audit failure, not an exploit (addendum §F).
    const seedFitness = candidates.find((c) => c.mutator === 'seed')?.evaluation?.fitness;
    const audit = gateExploit(outcome.audit, candidate.evaluation.fitness, seedFitness);
    const next: CandidateRecord = {
      ...candidate, audit, audit_pending: false, audit_error: null, adversarial_fitness: adversarialFitness(audit),
    };
    await deps.fs.writeFile(paths.candidateFile(candidateId), toJson(next));
    if (audit.verdict === 'exploit') {
      await deps.fs.mkdir(paths.exploitsDir, { recursive: true });
      const record = buildExploitRecord(spec, runId, next, audit, isRedQueen(spec) ? 'red_queen' : 'manual_audit');
      await deps.fs.writeFile(paths.exploitFile(candidateId), toJson(record));
    }
    return { ok: true, candidate: next, audit };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  } finally {
    client.dispose();
  }
}

export interface ExportedFixture {
  /** Absolute path written. */
  path: string;
  /** True when it went to the kernel fixtures folder; false when it stayed in the run's exploits folder. */
  inKernelFixtures: boolean;
  id: string;
}

/**
 * Write an exploit as a kernel fixture (the exploit record without the
 * audit; the audit summary stays in `notes`). Goes to
 * `kernel/tests/fixtures/exploits/<id>.json` when that folder exists in the
 * project, otherwise next to the run's other exploits.
 */
export async function exportExploitFixture(
  fs: DiscoveryFs,
  join: JoinFn,
  projectRoot: string,
  spec: DiscoverySpec,
  runId: string,
  definitionFile: string,
  candidate: CandidateRecord,
): Promise<AuditActionResult<ExportedFixture>> {
  const audit = candidate.audit;
  if (!audit || audit.verdict !== 'exploit') return { ok: false, error: `${candidate.id} has no exploit verdict to export.` };
  try {
    const record: ExploitRecord = buildExploitRecord(spec, runId, candidate, audit, isRedQueen(spec) ? 'red_queen' : 'manual_audit');
    const fixtureDir = join(projectRoot, ...KERNEL_EXPLOIT_DIR);
    const inKernelFixtures = await fs.exists(fixtureDir);
    const paths = runPaths(join, projectRoot, definitionFile, runId);
    const dir = inKernelFixtures ? fixtureDir : paths.exploitsDir;
    const path = join(dir, `${record.id}.json`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, toJson(toKernelFixture(record)));
    return { ok: true, path, inKernelFixtures, id: record.id };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
