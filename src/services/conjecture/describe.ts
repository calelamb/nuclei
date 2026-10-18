/** Plain-language renderings of conjecture parts, shared by the cards and the ledger list. */

import type { Conjecture, ConjecturePrediction, EvidenceOutcome, PredicateNode, TestFamily } from '../../types/conjecture';

const valueText = (v: unknown): string => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

/** One chip per top-level clause; nested groups read "any of (a; b)". */
export function predicateClauses(predicate: PredicateNode): string[] {
  if ('feature' in predicate) return [`${predicate.feature} ${predicate.op} ${valueText(predicate.value)}`];
  const group = 'all' in predicate ? predicate.all : predicate.any;
  return group.flatMap((child) =>
    'feature' in child ? predicateClauses(child) : [`${'all' in child ? 'all of' : 'any of'} (${predicateClauses(child).join('; ')})`],
  );
}

export const predicateMode = (predicate: Conjecture['feature_predicate']): 'all' | 'any' => ('all' in predicate ? 'all' : 'any');

export function predictionText(p: ConjecturePrediction): string {
  return `${p.quantity} ${p.op} ${p.value}`;
}

export function familyText(f: TestFamily): string {
  const { family, ...rest } = f;
  const parts = Object.entries(rest).map(([k, v]) => `${k.replace(/_/g, ' ')} ${valueText(v)}`);
  return [family, ...parts].join(', ');
}

export const OUTCOME_LABEL: Record<EvidenceOutcome, string> = {
  meets: 'Meets',
  violates: 'Violates',
  indeterminate: 'Indeterminate',
};

/** Honest wording: the kernel's summary is shown, with a fallback that never says "proven". */
export function honestSummary(summary: string, verdict: string, circuits: number, nMax: number): string {
  if (verdict === 'supported' && !/supported on \d+ held-out circuits up to n = \d+/i.test(summary)) {
    return `supported on ${circuits} held-out circuits up to n = ${nMax}. ${summary}`.trim();
  }
  return summary;
}
