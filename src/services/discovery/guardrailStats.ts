/**
 * Guardrail statistics for the Guardrails tab: why candidates were rejected,
 * how often each guardrail passes, and which isolation mode actually ran.
 */

import type { CandidateRecord, DiscoveryIsolation, DiscoveryReads, GuardrailStatus } from '../../types/discovery';
import { SANDBOX_HONESTY, SANDBOX_READS_CAVEAT } from './honesty';
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

export type ReadsReport = DiscoveryReads | 'unreported';
export type IsolationUse = Array<{ mode: DiscoveryIsolation | 'unknown'; reads: ReadsReport; count: number }>;

/** Evaluations per isolation mode and reported read restriction. A missing report is never counted as restricted. */
export function isolationUsed(candidates: readonly CandidateRecord[]): IsolationUse {
  const counts = new Map<string, { mode: DiscoveryIsolation | 'unknown'; reads: ReadsReport; count: number }>();
  for (const c of candidates) {
    const evaluation = c.evaluation;
    if (!evaluation) continue;
    const mode = evaluation.isolation ?? 'unknown';
    const reads: ReadsReport = evaluation.isolation_detail?.reads ?? 'unreported';
    const key = `${mode}/${reads}`;
    const prior = counts.get(key);
    counts.set(key, { mode, reads, count: (prior?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** True only when every counted evaluation reported restricted reads. */
export function allReadsRestricted(use: IsolationUse): boolean {
  return use.length > 0 && use.every((u) => u.reads === 'restricted');
}

/** Honest statement of what each isolation mode does and does not block, per the reads it reported. */
export function isolationNote(mode: DiscoveryIsolation | 'unknown', reads: ReadsReport = 'unreported'): string {
  switch (mode) {
    case 'sandbox-exec':
    case 'bwrap':
      if (reads === 'restricted') return `${SANDBOX_HONESTY} ${SANDBOX_READS_CAVEAT}`;
      if (reads === 'unrestricted') return 'The OS sandbox blocked network access and file writes, but these evaluations reported unrestricted file reads: they could read any file the app can read.';
      return 'The OS sandbox blocked network access and file writes. These evaluations did not report whether file reads were restricted, so do not assume they were.';
    case 'process':
      return 'Process isolation: a separate subprocess with resource limits and a cooperative import blocker. Nothing is blocked at the OS level: network access, file writes and file reads are all unblocked, and the import blocker is defense in depth rather than a boundary.';
    case 'unknown':
      return 'The kernel did not report an isolation mode for these evaluations.';
  }
}
