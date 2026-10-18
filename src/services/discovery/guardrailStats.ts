/**
 * Guardrail statistics for the Guardrails tab: why candidates were rejected,
 * how often each guardrail passes, and which isolation mode actually ran.
 */

import type { CandidateRecord, DiscoveryIsolation, GuardrailStatus } from '../../types/discovery';
import { numericId, primaryEvaluation } from './candidateView';

export interface RejectionReason {
  guardrail: string;
  label: string;
  count: number;
  candidateIds: string[];
  /** The most common message for this guardrail. */
  message: string;
}

export interface GuardrailPassRate {
  id: string;
  label: string;
  pass: number;
  warn: number;
  fail: number;
  skipped: number;
  /** pass / (pass + warn + fail); null when the guardrail never ran. */
  passRate: number | null;
}

export function rejectionReasons(candidates: readonly CandidateRecord[]): RejectionReason[] {
  const labels = new Map<string, string>();
  for (const c of candidates) {
    for (const g of primaryEvaluation(c)?.guardrails ?? []) labels.set(g.id, g.label);
  }
  const groups = new Map<string, { ids: string[]; messages: Map<string, number> }>();
  for (const c of candidates) {
    const evaluation = primaryEvaluation(c);
    if (evaluation?.status !== 'rejected' || !evaluation.rejection) continue;
    const { guardrail, message } = evaluation.rejection;
    const group = groups.get(guardrail) ?? { ids: [], messages: new Map<string, number>() };
    group.ids.push(c.id);
    group.messages.set(message, (group.messages.get(message) ?? 0) + 1);
    groups.set(guardrail, group);
  }
  return [...groups]
    .map(([guardrail, group]) => ({
      guardrail,
      label: labels.get(guardrail) ?? guardrail,
      count: group.ids.length,
      candidateIds: [...group.ids].sort((a, b) => numericId(a) - numericId(b)),
      message: [...group.messages].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    }))
    .sort((a, b) => b.count - a.count || a.guardrail.localeCompare(b.guardrail));
}

export function guardrailPassRates(candidates: readonly CandidateRecord[]): GuardrailPassRate[] {
  const table = new Map<string, GuardrailPassRate>();
  for (const c of candidates) {
    for (const g of c.evaluation?.guardrails ?? []) {
      const row = table.get(g.id) ?? { id: g.id, label: g.label, pass: 0, warn: 0, fail: 0, skipped: 0, passRate: null };
      const status: GuardrailStatus = g.status;
      table.set(g.id, { ...row, [status]: row[status] + 1 });
    }
  }
  return [...table.values()].map((row) => {
    const ran = row.pass + row.warn + row.fail;
    return { ...row, passRate: ran > 0 ? row.pass / ran : null };
  });
}

export type IsolationUse = Array<{ mode: DiscoveryIsolation | 'unknown'; count: number }>;

export function isolationUsed(candidates: readonly CandidateRecord[]): IsolationUse {
  const counts = new Map<DiscoveryIsolation | 'unknown', number>();
  for (const c of candidates) {
    const evaluation = c.evaluation;
    if (!evaluation) continue;
    const mode = evaluation.isolation ?? 'unknown';
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  return [...counts].map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count);
}

/** Honest statement of what each isolation mode does and does not block. */
export function isolationNote(mode: DiscoveryIsolation | 'unknown'): string {
  switch (mode) {
    case 'sandbox-exec':
    case 'bwrap':
      return 'OS sandbox: network access and file writes are blocked. File reads are not blocked.';
    case 'process':
      return 'Process isolation: a separate subprocess with resource limits and a cooperative import blocker. There is no OS sandbox, so file reads are not blocked either, and the import blocker is defense in depth rather than a boundary.';
    case 'unknown':
      return 'The kernel did not report an isolation mode for these evaluations.';
  }
}
