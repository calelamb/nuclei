/**
 * Actions on a finished (or stopped) run, driven from disk state: confirm the
 * champion on fresh seeds, and re-evaluate a single candidate. Both write
 * their result back to run.json / the candidate file.
 */

import type { CandidateRecord, DiscoverySpec, RunRecord } from '../../types/discovery';
import { confirmChampion, evaluateOnFreshSeeds, freshSeeds } from './confirmation';
import { createKernelEvaluator } from './kernelEval';
import { loadCandidates, loadRunRecord, runPaths, toJson } from './records';
import { createLimiter, type DiscoveryDeps, type DiscoveryRunContext } from './runContext';

export type PostRunResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function open(spec: DiscoverySpec, rctx: DiscoveryRunContext, deps: DiscoveryDeps, runId: string) {
  const paths = runPaths(deps.join, rctx.projectRoot, rctx.definitionFile, runId);
  const run = await loadRunRecord(deps.fs, paths);
  if (!run) return null;
  const { candidates } = await loadCandidates(deps.fs, paths);
  const map = new Map(candidates.map((c) => [c.id, c]));
  const kernel = createKernelEvaluator({ session: deps.session, info: rctx.evaluator, sleep: deps.clock.sleep });
  const env = {
    spec, runId, evaluator: rctx.evaluator, kernel, candidates: map, deps: { clock: deps.clock },
    evalLimit: createLimiter(spec.budget.max_concurrent_evaluations),
  };
  return { paths, run, map, kernel, env };
}

/** Re-run the champion on `count` fresh seeds and store the confirmed numbers. */
export async function confirmRunChampion(
  spec: DiscoverySpec,
  rctx: DiscoveryRunContext,
  deps: DiscoveryDeps,
  runId: string,
  count = spec.confirm.seeds || 3,
): Promise<PostRunResult<{ run: RunRecord }>> {
  const opened = await open(spec, rctx, deps, runId);
  if (!opened) return { ok: false, error: `Run ${runId} has no readable run.json.` };
  const { run, map, kernel, env, paths } = opened;
  try {
    const champion = run.champion_id ? map.get(run.champion_id) : undefined;
    if (!champion?.evaluation) return { ok: false, error: 'This run has no scored champion to confirm yet.' };
    const confirmation = await confirmChampion(env, champion, count, `manual-${deps.clock.now().getTime()}`);
    const next: RunRecord = { ...run, confirmation, updated_at: deps.clock.now().toISOString() };
    await deps.fs.writeFile(paths.runJson, toJson(next));
    return { ok: true, run: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    kernel.dispose();
  }
}

/** Evaluate one candidate again at stage `full` on a fresh seed; the result is appended to `reevaluations`. */
export async function reevaluateCandidate(
  spec: DiscoverySpec,
  rctx: DiscoveryRunContext,
  deps: DiscoveryDeps,
  runId: string,
  candidateId: string,
): Promise<PostRunResult<{ candidate: CandidateRecord }>> {
  const opened = await open(spec, rctx, deps, runId);
  if (!opened) return { ok: false, error: `Run ${runId} has no readable run.json.` };
  const { map, kernel, env, paths } = opened;
  try {
    const candidate = map.get(candidateId);
    if (!candidate || !candidate.program) return { ok: false, error: `Candidate ${candidateId} was not found.` };
    const salt = `reeval-${candidateId}-${candidate.reevaluations.length}`;
    const [seed] = freshSeeds(spec, map.values(), 1, salt);
    const [evaluation] = await evaluateOnFreshSeeds(env, candidate.program, candidateId, [seed], 'full');
    if (!evaluation) return { ok: false, error: 'The re-evaluation was cancelled.' };
    const next: CandidateRecord = { ...candidate, reevaluations: [...candidate.reevaluations, evaluation] };
    await deps.fs.writeFile(paths.candidateFile(candidateId), toJson(next));
    return { ok: true, candidate: next };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    kernel.dispose();
  }
}
