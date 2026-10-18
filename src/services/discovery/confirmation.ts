/**
 * Champion confirmation (honesty principle 4) and post-run actions. The
 * champion is re-evaluated at stage `confirm` on seeds that no candidate has
 * used, and the mean with a t-interval is reported as the confirmed number.
 */

import type {
  CandidateRecord,
  DiscoveryEvaluation,
  DiscoveryEvaluatorInfo,
  DiscoverySpec,
  RunConfirmation,
} from '../../types/discovery';
import { summarizeConfirmation } from './cascade';
import { isCancelled, type KernelEvaluator } from './kernelEval';
import type { Limiter, RunnerClock } from './runContext';
import { deriveSeed } from './rng';

export interface ConfirmEnv {
  spec: DiscoverySpec;
  runId: string;
  evaluator: DiscoveryEvaluatorInfo;
  kernel: KernelEvaluator;
  evalLimit: Limiter;
  candidates: ReadonlyMap<string, CandidateRecord>;
  deps: { clock: RunnerClock };
}

/** `count` seeds not used by any candidate evaluation; `salt` keeps repeated confirmations distinct. */
export function freshSeeds(
  spec: DiscoverySpec,
  candidates: Iterable<CandidateRecord>,
  count: number,
  salt: string,
): number[] {
  const used = new Set<number>();
  for (const c of candidates) {
    used.add(c.eval_seed);
    [c.evaluation, c.screen, ...c.reevaluations].forEach((e) => e && used.add(e.seed));
  }
  const seeds: number[] = [];
  for (let k = 0; seeds.length < count; k += 1) {
    const seed = deriveSeed(spec.seed, `confirm:${salt}:${k}`);
    if (!used.has(seed) && !seeds.includes(seed)) seeds.push(seed);
  }
  return seeds;
}

export async function evaluateOnFreshSeeds(
  env: ConfirmEnv,
  program: string,
  wirePrefix: string,
  seeds: readonly number[],
  stage: 'confirm' | 'full',
): Promise<DiscoveryEvaluation[]> {
  const results = await Promise.all(
    seeds.map((seed, i) =>
      env.evalLimit(() =>
        env.kernel.evaluate({
          runId: env.runId,
          wireId: `${wirePrefix}~${stage}${i}`,
          evaluator: { kind: env.spec.evaluator.kind, config: env.spec.evaluator.config },
          program,
          entry: env.spec.entry,
          seed,
          stage,
        }),
      ),
    ),
  );
  return results.filter((e) => !isCancelled(e));
}

export async function confirmChampion(
  env: ConfirmEnv,
  champion: CandidateRecord,
  count: number,
  salt: string,
): Promise<RunConfirmation> {
  const seeds = freshSeeds(env.spec, env.candidates.values(), count, salt);
  const evaluations = await evaluateOnFreshSeeds(env, champion.program, champion.id, seeds, 'confirm');
  return summarizeConfirmation({
    championId: champion.id,
    championFitness: champion.evaluation?.fitness ?? 0,
    seeds,
    evaluations,
    now: env.deps.clock.now().toISOString(),
  });
}
