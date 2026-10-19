/**
 * The archive digest (addendum §G.1): a pure, capped, deterministic summary
 * of a Discovery run that Claude reads before proposing conjectures. Every
 * cap is disclosed ("N of M"), and when the evaluator carries no structural
 * features the digest says so and uses objectives and descriptors only.
 *
 * Reads Frontier-evaluator fields defensively: `metrics.features`, the `beta`
 * and `pp_exact_cost` objectives (older runs on disk: `estimation_hardness`), and the `log2_dla_dimension` descriptor.
 */

import type { CandidateRecord, RunRecord } from '../../types/discovery';
import { allElites, uniqueByCandidate } from '../discovery/archive';

export const MIN_SCORED_ELITES = 8;
export const DIGEST_CAPS = { topElites: 30, bottomElites: 10, categories: 8, numericBins: 4 } as const;

type Features = Record<string, unknown>;

interface DigestElite {
  id: string;
  rank: 'top' | 'bottom';
  fitness: number;
  features: Features | null;
  objectives: Record<string, { value: number; ci95: [number, number] | null }>;
  descriptors: Record<string, number>;
  beta: number | null;
  beta_ci95: [number, number] | null;
  hardness: number | null;
  hardness_censored: boolean | null;
  log2_dla_dimension: number | null;
  scaling_points: number | null;
}

interface FeatureBucket {
  value: string;
  n: number;
  mean_fitness: number;
  mean_beta_upper95: number | null;
}

interface FeatureSummary {
  feature: string;
  kind: 'numeric' | 'categorical';
  n_with_value: number;
  buckets: FeatureBucket[];
}

interface DigestCounts {
  candidates: number;
  scored: number;
  rejected: number;
  failed: number;
  not_evaluated: number;
  archive_elites: number;
  scored_with_features: number;
}

interface DigestPayload {
  evaluator: string;
  evaluator_fingerprint: string | null;
  run_id: string;
  counts: DigestCounts;
  feature_source: 'features' | 'descriptors_only';
  elites: DigestElite[];
  feature_summaries: FeatureSummary[];
}

export interface Digest {
  payload: DigestPayload;
  /** Compact JSON handed to the model. */
  text: string;
  /** Human-readable "N of M" lines for the UI and the ledger. */
  disclosures: string[];
  disclosure: string;
  scoredElites: number;
}

interface DigestInput {
  run: RunRecord;
  candidates: Record<string, CandidateRecord>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sig = (v: number): number => (v === 0 ? 0 : Number(v.toPrecision(4)));
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function interval(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null ? [sig(v[0] as number), sig(v[1] as number)] : null;
}

function featuresOf(c: CandidateRecord): Features | null {
  const f = c.evaluation?.metrics?.features;
  return isObject(f) && Object.keys(f).length > 0 ? f : null;
}

function hardnessCensored(c: CandidateRecord): boolean | null {
  const m = c.evaluation?.metrics ?? {};
  const cost = isObject(m.pp_exact_cost) ? m.pp_exact_cost.censored : undefined;
  const legacy = isObject(m.estimation_hardness) ? m.estimation_hardness.censored : undefined;
  for (const v of [m.hardness_censored, m.censored, cost, legacy]) if (typeof v === 'boolean') return v;
  return null;
}

function betaUpper(c: CandidateRecord): number | null {
  const beta = c.evaluation?.objectives.beta;
  return beta?.ci95 ? num(beta.ci95[1]) : null;
}

function eliteRow(c: CandidateRecord, rank: 'top' | 'bottom'): DigestElite {
  const ev = c.evaluation!;
  const beta = ev.objectives.beta;
  const points = ev.metrics.points;
  return {
    id: c.id,
    rank,
    fitness: sig(ev.fitness ?? 0),
    features: featuresOf(c),
    objectives: Object.fromEntries(
      Object.entries(ev.objectives).map(([k, o]) => [k, { value: sig(o.value), ci95: interval(o.ci95) }]),
    ),
    descriptors: Object.fromEntries(Object.entries(ev.descriptors).map(([k, v]) => [k, sig(v)])),
    beta: beta ? sig(beta.value) : null,
    beta_ci95: interval(beta?.ci95),
    hardness: num((ev.objectives.pp_exact_cost ?? ev.objectives.estimation_hardness)?.value),
    hardness_censored: hardnessCensored(c),
    log2_dla_dimension: num(ev.descriptors.log2_dla_dimension),
    scaling_points: Array.isArray(points) ? points.length : null,
  };
}

function bucketize(values: Array<{ x: unknown; fitness: number; beta: number | null }>): FeatureBucket[] {
  const summarize = (label: string, rows: typeof values): FeatureBucket => {
    const betas = rows.map((r) => r.beta).filter((b): b is number => b !== null);
    return { value: label, n: rows.length, mean_fitness: sig(mean(rows.map((r) => r.fitness))), mean_beta_upper95: betas.length ? sig(mean(betas)) : null };
  };
  if (values.every((v) => num(v.x) !== null)) {
    const sorted = [...values].sort((a, b) => (a.x as number) - (b.x as number));
    const bins = Math.min(DIGEST_CAPS.numericBins, sorted.length);
    return Array.from({ length: bins }, (_, i) => {
      const rows = sorted.slice(Math.floor((i * sorted.length) / bins), Math.floor(((i + 1) * sorted.length) / bins));
      const lo = rows[0].x as number;
      const hi = rows[rows.length - 1].x as number;
      return summarize(lo === hi ? String(sig(lo)) : `${sig(lo)}..${sig(hi)}`, rows);
    });
  }
  const groups = new Map<string, typeof values>();
  for (const v of values) groups.set(String(v.x), [...(groups.get(String(v.x)) ?? []), v]);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const head = ordered.slice(0, DIGEST_CAPS.categories).map(([k, rows]) => summarize(k, rows));
  const tail = ordered.slice(DIGEST_CAPS.categories).flatMap(([, rows]) => rows);
  return tail.length > 0 ? [...head, summarize('other', tail)] : head;
}

function featureSummaries(scored: CandidateRecord[]): FeatureSummary[] {
  const byKey = new Map<string, Array<{ x: unknown; fitness: number; beta: number | null }>>();
  for (const c of scored) {
    const f = featuresOf(c);
    if (!f) continue;
    for (const [k, x] of Object.entries(f)) {
      if (isObject(x)) continue; // nested maps (axis counts) are shown per elite only
      byKey.set(k, [...(byKey.get(k) ?? []), { x, fitness: c.evaluation!.fitness ?? 0, beta: betaUpper(c) }]);
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([feature, rows]) => ({
      feature,
      kind: rows.every((r) => num(r.x) !== null) ? ('numeric' as const) : ('categorical' as const),
      n_with_value: rows.length,
      buckets: bucketize(rows),
    }));
}

function isScored(c: CandidateRecord | undefined): c is CandidateRecord {
  return !!c && c.evaluation?.status === 'scored' && c.evaluation.fitness !== null;
}

export function buildDigest({ run, candidates }: DigestInput): Digest {
  const all = Object.values(candidates);
  const scored = all.filter(isScored);
  const eliteIds = uniqueByCandidate(allElites(run.archive)).map((e) => e.candidateId);
  const scoredElites = eliteIds.map((id) => candidates[id]).filter(isScored).sort((a, b) => b.evaluation!.fitness! - a.evaluation!.fitness! || a.id.localeCompare(b.id));
  const top = scoredElites.slice(0, DIGEST_CAPS.topElites);
  const bottom = scoredElites.slice(DIGEST_CAPS.topElites).slice(-DIGEST_CAPS.bottomElites);
  const elites = [...top.map((c) => eliteRow(c, 'top')), ...bottom.map((c) => eliteRow(c, 'bottom'))];
  const withFeatures = scored.filter((c) => featuresOf(c) !== null);

  const counts: DigestCounts = {
    candidates: all.length,
    scored: scored.length,
    rejected: all.filter((c) => c.evaluation?.status === 'rejected').length,
    failed: all.filter((c) => c.evaluation?.status === 'failed').length,
    not_evaluated: all.filter((c) => c.evaluation === null).length,
    archive_elites: eliteIds.length,
    scored_with_features: withFeatures.length,
  };
  const payload: DigestPayload = {
    evaluator: run.evaluator.kind,
    evaluator_fingerprint: run.evaluator.fingerprint,
    run_id: run.run_id,
    counts,
    feature_source: withFeatures.length > 0 ? 'features' : 'descriptors_only',
    elites,
    feature_summaries: featureSummaries(scored),
  };

  const disclosures = [`Digest shows ${elites.length} of ${scoredElites.length} scored archive elites (${top.length} best, ${bottom.length} weakest).`,
    `Per-feature summaries use ${withFeatures.length} of ${scored.length} scored candidates.`];
  if (payload.feature_source === 'descriptors_only') {
    disclosures.push('This evaluator records no structural features, so the digest has objectives and descriptors only. Conjectures about circuit structure will be weakly grounded.');
  }
  if (counts.rejected + counts.failed > 0) {
    disclosures.push(`${counts.rejected} rejected and ${counts.failed} failed candidates are counted but not described.`);
  }
  return { payload, text: JSON.stringify(payload), disclosures, disclosure: disclosures.join(' '), scoredElites: scoredElites.length };
}
