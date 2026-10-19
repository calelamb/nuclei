/**
 * Normalise the kernel's per-circuit evidence item:
 * `{circuit_index, variant_id, family_params, features, regenerate, points[], fit, dla,
 *   quantity{..., observed}, outcome, reason}` with points
 * `{n_qubits, variance, interval, method, status, loose, error}`.
 * Missing pieces degrade to "indeterminate" or null, never to an invented verdict.
 */

import type { EvidenceOutcome, EvidencePoint, EvidenceRow } from '../../types/conjecture';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function pair(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null ? [v[0] as number, v[1] as number] : null;
}

function outcomeOf(item: Record<string, unknown>): EvidenceOutcome {
  if (item.outcome === 'meets' || item.outcome === 'violates' || item.outcome === 'indeterminate') return item.outcome;
  if (item.meets === true) return 'meets';
  if (item.meets === false) return 'violates';
  return 'indeterminate';
}

function pointOf(raw: unknown): EvidencePoint | null {
  if (!isObject(raw)) return null;
  const n = num(raw.n_qubits);
  const variance = num(raw.variance);
  if (n === null || variance === null) return null;
  const ci = pair(raw.interval);
  return { n, variance, lo: ci ? ci[0] : null, hi: ci ? ci[1] : null };
}

function observedOf(quantity: unknown): EvidenceRow['observed'] {
  const obs = isObject(quantity) ? quantity.observed : null;
  if (num(obs) !== null) return obs as number;
  if (Array.isArray(obs) && obs.length === 2 && num(obs[0]) !== null) return [obs[0] as number, num(obs[1])];
  return null;
}

export function normalizeEvidence(item: unknown, fallbackIndex: number): EvidenceRow {
  const raw = isObject(item) ? item : {};
  const fit = isObject(raw.fit) ? raw.fit : {};
  const exp = isObject(fit.exponential) ? fit.exponential : {};
  const betaCi = pair(exp.beta_ci95);
  const regenerate = isObject(raw.regenerate) ? raw.regenerate : {};
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map(pointOf)
    .filter((p): p is EvidencePoint => p !== null)
    .sort((a, b) => a.n - b.n);
  return {
    circuitIndex: num(raw.circuit_index) ?? fallbackIndex,
    variantId: typeof raw.variant_id === 'string' ? raw.variant_id : null,
    outcome: outcomeOf(raw),
    features: isObject(raw.features) ? raw.features : {},
    beta: num(exp.beta),
    betaCi,
    betaUpper95: betaCi ? betaCi[1] : null,
    points,
    seed: num(regenerate.seed),
    note: typeof raw.reason === 'string' && raw.reason ? raw.reason : null,
    observed: observedOf(raw.quantity),
  };
}
