/**
 * Dirac context for the Discovery Engine (PRD 14 §7.4): a pure, capped text
 * summary of the selected study and run. Every truncation is disclosed as
 * "N of M" so the assistant never mistakes a sample for the whole.
 */

import type { CandidateRecord, DiscoverySpec, RunRecord } from '../../types/discovery';
import { computeKpis } from './kpis';
import { summarizeRejections } from './prompt';

export const CONTEXT_MAX_CHARS = 6000;
const CONTEXT_TOP_CANDIDATES = 5;
const CONTEXT_REJECTIONS = 5;
const CONTEXT_NOTICES = 3;
const CONTEXT_PROGRAM_LINES = 40;

interface DiscoveryContextInput {
  spec: DiscoverySpec | null;
  run: RunRecord | null;
  candidates: readonly CandidateRecord[];
  selectedCandidateId?: string | null;
}

const fmt = (n: number | null | undefined, digits = 4): string =>
  n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : Number(n.toPrecision(digits)).toString();

function objectiveLine(key: string, o: { value: number; ci95?: [number, number] | null; direction: string }): string {
  const ci = o.ci95 ? ` (95% CI ${fmt(o.ci95[0])} to ${fmt(o.ci95[1])})` : '';
  return `${key} = ${fmt(o.value)}${ci}, ${o.direction}`;
}

function capped(text: string): string {
  if (text.length <= CONTEXT_MAX_CHARS) return text;
  return `${text.slice(0, CONTEXT_MAX_CHARS)}\n[context cut at ${CONTEXT_MAX_CHARS} of ${text.length} characters]`;
}

export function buildDiscoveryContext(input: DiscoveryContextInput): string {
  const { spec, run, candidates } = input;
  if (!spec && !run) return '';
  const lines: string[] = ['## Discovery Engine'];

  if (spec) {
    lines.push(
      `Study: ${spec.name}${spec.description ? ` - ${spec.description}` : ''}`,
      `Evaluator: ${spec.evaluator.kind}; seed program ${spec.program}; mutator ${spec.mutator.kind}${spec.mutator.kind === 'ast' ? '' : ` (breadth ${spec.mutator.models.breadth}, depth ${spec.mutator.models.depth}, ${Math.round(spec.mutator.models.depth_share * 100)}% depth)`}`,
      `Search: ${spec.search.islands} islands, ${spec.search.generations} generations x ${spec.search.candidates_per_generation} candidates, cascade ${spec.evaluation.cascade ? `on (${spec.evaluation.promote_if})` : 'off'}`,
    );
  }
  if (!run) return capped(lines.join('\n'));

  const kpis = computeKpis(run, candidates);
  const budget = run.spec.budget;
  lines.push(
    '',
    `Run ${run.run_id}: ${run.status}${run.stop_reason ? ` (${run.stop_reason})` : ''}, generation ${run.generation} of ${run.spec.search.generations}.`,
    `Budget used: ${run.usage.evaluations} of ${budget.max_evaluations} evaluations, ${run.usage.llm_calls} of ${budget.max_llm_calls} LLM calls, ${Math.round(run.usage.wall_ms / 60000)} of ${budget.max_wall_minutes} minutes.`,
    `Candidates: ${kpis.counts.proposed} proposed; ${kpis.counts.scored} scored, ${kpis.counts.rejected} rejected, ${kpis.counts.failed} failed, ${kpis.counts.screenedOut} screened out, ${kpis.counts.duplicate} duplicates, ${kpis.counts.invalid} invalid edits, ${kpis.counts.pending} pending.`,
    `Fitness: seed ${fmt(kpis.seedFitness)}, best ${fmt(kpis.bestFitness)} (change ${fmt(kpis.bestDelta)}). Acceptance rate ${kpis.acceptanceRate === null ? 'n/a' : `${Math.round(kpis.acceptanceRate * 100)}%`}. Improvements: ${kpis.improvements.llm} from LLM, ${kpis.improvements.ast} from AST. Tokens: ${kpis.tokens.total}.`,
  );
  if (run.message) lines.push(`Message: ${run.message}`);

  if (kpis.championObjective) {
    lines.push(`Champion ${kpis.championId}: ${objectiveLine(kpis.championObjective.key, kpis.championObjective.value)} (selected, before confirmation).`);
  }
  if (run.confirmation) {
    const c = run.confirmation;
    lines.push(
      `Confirmation on ${c.n_scored} of ${c.seeds.length} fresh seeds: ` +
        (c.objectives.length === 0
          ? 'no scored seeds.'
          : c.objectives.map((o) => `${o.key} mean ${fmt(o.mean)}${o.ci95 ? ` (95% CI ${fmt(o.ci95[0])} to ${fmt(o.ci95[1])})` : ' (no CI from one seed)'}`).join('; ')) +
        ` Winner's-curse fitness drop ${fmt(c.fitness_drop)}.`,
    );
  }

  const scored = candidates
    .filter((c) => c.mutator !== 'seed' && c.evaluation?.status === 'scored' && c.outcome === 'evaluated')
    .sort((a, b) => (b.evaluation?.fitness ?? 0) - (a.evaluation?.fitness ?? 0));
  if (scored.length > 0) {
    lines.push('', `Top candidates (${Math.min(CONTEXT_TOP_CANDIDATES, scored.length)} of ${scored.length} scored):`);
    for (const c of scored.slice(0, CONTEXT_TOP_CANDIDATES)) {
      lines.push(`- ${c.id} (${c.mutator}, island ${c.island + 1}, gen ${c.generation}) fitness ${fmt(c.evaluation?.fitness)}${c.llm ? `: ${c.llm.rationale.slice(0, 120)}` : ''}`);
    }
  }

  const rejected = candidates.flatMap((c) => (c.evaluation?.rejection ? [c.evaluation.rejection] : []));
  if (rejected.length > 0) {
    const top = summarizeRejections(rejected, CONTEXT_REJECTIONS);
    lines.push('', `Top rejection reasons (${top.length} of ${new Set(rejected.map((r) => `${r.guardrail}|${r.message}`)).size} distinct, ${rejected.length} rejections):`);
    for (const r of top) lines.push(`- ${r.guardrail} x${r.count}: ${r.message.slice(0, 160)}`);
  }

  const selected = input.selectedCandidateId ? candidates.find((c) => c.id === input.selectedCandidateId) : undefined;
  if (selected) {
    lines.push('', `Selected candidate ${selected.id} (${selected.mutator}, outcome ${selected.outcome}${selected.parent_id ? `, parent ${selected.parent_id}` : ''}):`);
    if (selected.llm) lines.push(`Rationale: ${selected.llm.rationale}`, `Expected effect: ${selected.llm.expected_effect}`);
    if (selected.ast_ops) lines.push(`AST operators: ${selected.ast_ops.join(', ')}`);
    if (selected.proposal_error) lines.push(`Edit rejected: ${selected.proposal_error}`);
    const ev = selected.evaluation;
    if (ev) {
      lines.push(`Status ${ev.status}${ev.fitness !== null ? `, fitness ${fmt(ev.fitness)}` : ''}${ev.rejection ? `, rejected by ${ev.rejection.guardrail}: ${ev.rejection.message}` : ''}`);
      for (const [key, o] of Object.entries(ev.objectives)) lines.push(`- ${objectiveLine(key, o)}`);
      const warns = ev.guardrails.filter((g) => g.status === 'warn' || g.status === 'fail');
      if (warns.length > 0) lines.push(`Guardrails needing attention: ${warns.map((g) => `${g.id} (${g.status})`).join(', ')}`);
    }
    const programLines = selected.program.replace(/\n$/, '').split('\n');
    const shown = programLines.slice(0, CONTEXT_PROGRAM_LINES);
    lines.push(`Program (showing ${shown.length} of ${programLines.length} lines):`, ...shown.map((l) => `  ${l}`));
  }

  const notices = run.notices;
  if (notices.length > 0) {
    lines.push('', `Notices (${Math.min(CONTEXT_NOTICES, notices.length)} of ${notices.length}):`, ...notices.slice(-CONTEXT_NOTICES).map((n) => `- ${n.slice(0, 200)}`));
  }
  return capped(lines.join('\n'));
}
