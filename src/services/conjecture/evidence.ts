/**
 * Normalise the kernel's per-circuit evidence item. The wire contract fixes
 * the envelope (`discovery_conjecture_evidence {job_id, item}`) but leaves
 * the item open, so this reads the plausible spellings defensively and
 * falls back to "indeterminate" rather than inventing a verdict.
 */

import type { EvidenceOutcome, EvidencePoint, EvidenceRow } from '../../types/conjecture';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function pair(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null ? [v[0] as number, v[1] as number] : null;
}

function outcomeOf(item: Record<string, unknown>): EvidenceOutcome {
  for (const v of [item.outcome, item.status, item.verdict, item.meets]) {
    if (v === true) return 'meets';
    if (v === false) return 'violates';
    if (typeof v !== 'string') continue;
    const s = v.toLowerCase();
    if (['meets', 'meet', 'supported', 'pass', 'passes'].includes(s)) return 'meets';
    if (['violates', 'violate', 'refuted', 'fail', 'fails'].includes(s)) return 'violates';
    if (['indeterminate', 'inconclusive', 'unknown'].includes(s)) return 'indeterminate';
  }
  return 'indeterminate';
}

function pointOf(raw: unknown): EvidencePoint | null {
  if (!isObject(raw)) return null;
  const n = num(raw.n_qubits) ?? num(raw.n);
  const variance = num(raw.variance);
  if (n === null || variance === null) return null;
  const ci = pair(raw.variance_ci95) ?? pair(raw.interval) ?? pair(raw.ci95);
  return { n, variance, lo: ci ? ci[0] : null, hi: ci ? ci[1] : null };
}

export function normalizeEvidence(item: unknown, fallbackIndex: number): EvidenceRow {
  const raw = isObject(item) ? item : {};
  const fit = isObject(raw.fit) ? raw.fit : isObject(raw.exponential) ? raw.exponential : {};
  const betaCi = pair(raw.beta_ci95) ?? pair(fit.beta_ci95);
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map(pointOf)
    .filter((p): p is EvidencePoint => p !== null)
    .sort((a, b) => a.n - b.n);
  return {
    circuitIndex: num(raw.circuit_index) ?? num(raw.index) ?? fallbackIndex,
    outcome: outcomeOf(raw),
    features: isObject(raw.features) ? raw.features : {},
    beta: num(raw.beta) ?? num(fit.beta),
    betaCi,
    betaUpper95: num(raw.beta_upper95) ?? num(fit.beta_upper95) ?? (betaCi ? betaCi[1] : null),
    points,
    seed: num(raw.seed),
    note: typeof raw.note === 'string' ? raw.note : typeof raw.reason === 'string' ? raw.reason : null,
  };
}
