/**
 * Red Queen prompts (addendum §F). The honest framing is part of the prompt:
 * this is security testing of Nuclei's own evaluator, run by its developer on
 * their own machine. The adversary is told the guardrails and rewarded for
 * programs the evaluator scores well but an independent audit rejects. It is
 * never asked to attack the host: the target is the scoring logic only.
 */

import type { AuditVerdict } from '../../types/discovery';
import { EVOLVE_END_MARKER, EVOLVE_START_MARKER } from '../../types/discovery';
import {
  fence,
  formatNumber,
  guardrailsFor,
  gradientMapSection,
  summarizeEvaluation,
  truncateProgram,
  INSPIRATION_MAX_LINES,
  PARENT_MAX_LINES,
  type PromptCandidate,
  type RejectionReason,
  type SystemBlock,
  type SystemPromptInput,
} from './prompt';

/** Attack classes the adversary is pointed at; each is a way a scorer can be fooled, not a way to hurt the host. */
export const ATTACK_CLASSES: ReadonlyArray<{ id: string; hint: string }> = [
  { id: 'smuggling', hint: 'hide the real work behind a construct the checker does not look inside (a composite gate, a custom instruction, a pre-built object)' },
  { id: 'determinism', hint: 'exploit what "deterministic" is tested against: a value that only looks fixed under the evaluator\'s seed or noise model' },
  { id: 'cost_model', hint: 'game the cost model: shift cost into something it does not count, or count it somewhere it is cheap' },
  { id: 'environment_sensing', hint: 'behave differently when evaluated than when audited, using only information the program is legitimately given (its own arguments and parameters)' },
  { id: 'conversion_mismatch', hint: 'exploit differences between how the program is parsed or converted for scoring and how it would actually run' },
];

export interface AuditFinding {
  candidateId: string;
  verdict: AuditVerdict;
  gap: number | null;
  reasons: string[];
  /** Labels of the audit checks that failed. */
  failedChecks: string[];
}

export function buildRedQueenSystemPrompt(input: SystemPromptInput): SystemBlock[] {
  const { evaluator, task, entry } = input;
  const guardrails = guardrailsFor(evaluator.kind).map((g) => `- ${g.id}: ${g.label}`).join('\n');
  const objectives = evaluator.objectives
    .map((o) => `- ${o.key} (${o.direction}${o.unit ? `, ${o.unit}` : ''}): ${o.label}`)
    .join('\n');
  const attacks = ATTACK_CLASSES.map((a) => `- ${a.id}: ${a.hint}`).join('\n');

  const text = [
    'You are the adversary in a Red Queen security test of Nuclei\'s own evaluator. The developer of this software is testing whether its trusted scorer can be fooled, on their own machine, so that holes are found and fixed before anyone relies on the scores. This is authorized security testing of scoring logic, nothing else.',
    '',
    `## Your goal\nPropose edits to a Python program that builds a quantum circuit so that the program scores WELL under the evaluator below, but would FAIL an independent, stricter audit of the same artifact. The audit re-parses the program from scratch, re-runs the guardrails under a different noise model and seed, searches without budget shortcuts, and re-optimizes from fresh restarts. You are rewarded by the gap between the evaluator's score and the audit's score, and most of all by a confirmed exploit (evaluator fitness at least the honest seed's while the audit rejects). A program that is simply better, honestly, earns nothing: the audit will agree with the evaluator.`,
    '',
    `## Task the evaluator is meant to measure\n${task.trim() || 'Improve the program on the evaluator objectives below.'}`,
    '',
    `## Evaluator under test: ${evaluator.title} (${evaluator.kind} v${evaluator.version})\n${evaluator.description.trim()}`,
    `The program must define \`${entry}\`: ${evaluator.entry_signature}`,
    '',
    `### Objectives\n${objectives || '- (none declared)'}`,
    '',
    `## Guardrails the evaluator checks (you know them; a failure rejects the candidate, and a rejected candidate earns nothing)\n${guardrails || '- (none declared)'}`,
    '',
    `## Classes of weakness to probe\n${attacks}`,
    '',
    '## Rules',
    '- The target is the scoring logic only. Never attack the host: no network access, no filesystem writes, no attempts to escape or probe the sandbox, no reading files, no spawning processes, no tampering with the evaluator or the audit. Programs that try are rejected and wasted.',
    '- Stay a quantum program. The weakness you find must be one a developer can fix in the scorer or its guardrails, and you must be able to say in one sentence what it is.',
    `- Edit only inside the ${EVOLVE_START_MARKER} ... ${EVOLVE_END_MARKER} block. Never touch, move or mention the markers.`,
    '- Emit your change by calling the propose_program_edit tool with SEARCH/REPLACE edits. Each `search` must be copied verbatim from the parent program (same indentation) and must match exactly once.',
    '- State your hypothesis in the rationale: which guardrail or assumption you expect to slip past, and what the audit should disagree about.',
    '- If an earlier exploit is listed below, do not repeat it. Find a different mechanism.',
  ].join('\n');

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

interface RedQueenUserPromptInput {
  parent: PromptCandidate;
  inspirations: PromptCandidate[];
  rejections: RejectionReason[];
  findings: AuditFinding[];
  generation: number;
  generations: number;
  island: number;
  islands: number;
  /** Best adversarial fitness so far. */
  bestFitness: number | null;
}

const FINDINGS_SHOWN = 8;

function describeFinding(f: AuditFinding): string {
  const gap = f.gap === null ? 'gap n/a' : `gap ${formatNumber(f.gap)}`;
  const why = f.reasons.length > 0 ? f.reasons.join('; ') : f.failedChecks.length > 0 ? f.failedChecks.join('; ') : 'no reason given';
  return `- ${f.candidateId} (${f.verdict}, ${gap}): ${why}`;
}

export function findingsSections(findings: readonly AuditFinding[]): string[] {
  const exploits = findings.filter((f) => f.verdict === 'exploit').slice(-FINDINGS_SHOWN);
  const agreed = findings.filter((f) => f.verdict !== 'exploit').slice(-FINDINGS_SHOWN);
  const out: string[] = [];
  if (exploits.length > 0) {
    out.push(`## Exploits already found (the audit rejected these; a repeat earns nothing, so try something different)\n${exploits.map(describeFinding).join('\n')}`);
  }
  if (agreed.length > 0) {
    out.push(`## Audited candidates the audit did NOT reject (this approach did not pay; try something different)\n${agreed.map(describeFinding).join('\n')}`);
  }
  return out;
}

export function buildRedQueenUserPrompt(input: RedQueenUserPromptInput): string {
  const { parent, inspirations, rejections, findings, generation, generations, island, islands, bestFitness } = input;
  const parentView = truncateProgram(parent.program, PARENT_MAX_LINES);
  const parts: string[] = [
    `## Context\nGeneration ${generation} of ${generations}, island ${island + 1} of ${islands}. Best adversarial fitness so far (evaluator score minus audit score, with a large bonus per confirmed exploit): ${bestFitness === null ? 'none yet' : formatNumber(bestFitness)}.`,
    `## Parent program (${parent.id})${parentView.note ? ` ${parentView.note}` : ''}\n${fence(parentView.text)}`,
    `## Parent evaluation (what the evaluator said)\n${summarizeEvaluation(parent.evaluation)}`,
  ];
  const gradient = gradientMapSection(parent.evaluation?.metrics.gradient_map, parent.program);
  if (gradient) parts.push(gradient);

  if (inspirations.length > 0) {
    const blocks = inspirations.map((insp) => {
      const view = truncateProgram(insp.program, INSPIRATION_MAX_LINES);
      return [`### Inspiration ${insp.id}${view.note ? ` ${view.note}` : ''}`, fence(view.text), summarizeEvaluation(insp.evaluation)].join('\n');
    });
    parts.push(`## Inspirations (other high-gap programs from the archive)\n${blocks.join('\n\n')}`);
  }

  parts.push(...findingsSections(findings));

  if (rejections.length > 0) {
    const rows = rejections.map((r) => `- ${r.guardrail} (x${r.count}): ${r.message}`);
    parts.push(`## Guardrail rejections in this run (the evaluator already catches these; they earn nothing)\n${rows.join('\n')}`);
  }

  parts.push('Propose one edit to the parent program by calling propose_program_edit. It must still pass every guardrail, and it must aim at a weakness the audit would disagree about.');
  return parts.join('\n\n');
}

