/**
 * Prompt construction for the LLM mutator (PRD 14 §7.4, addendum §C).
 *
 * The system block is stable across a run (it carries the persona, task,
 * evaluator description, guardrails and rules) and is marked
 * `cache_control: ephemeral` so repeated proposals reuse it. Everything that
 * varies per proposal lives in the user prompt. Anything the model might
 * otherwise assume is shown in full or disclosed as "N of M".
 */

import type {
  DiscoveryEvaluation,
  DiscoveryEvaluatorInfo,
  DiscoveryEvaluatorKind,
  GradientMap,
  ObjectiveValue,
} from '../../types/discovery';
import { EVOLVE_END_MARKER, EVOLVE_START_MARKER } from '../../types/discovery';
import { deadGradientLines } from './gradient';

export const INSPIRATION_MAX_LINES = 60;
export const PARENT_MAX_LINES = 400;
export const GRADIENT_MAP_MAX_LINES = 12;
const REJECTION_REASONS_SHOWN = 5;

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface GuardrailInfo {
  id: string;
  label: string;
}

/** What the trusted scorer checks, per evaluator (spec §6.3 and addendum §B). */
const GUARDRAILS: Record<DiscoveryEvaluatorKind, GuardrailInfo[]> = {
  qec_memory: [
    { id: 'parse', label: 'the circuit text parses as Stim' },
    { id: 'noiseless', label: 'no noise channels: the evaluator applies the noise model, never the candidate' },
    { id: 'gate_set', label: 'only allowed gates' },
    { id: 'qubit_budget', label: 'qubit count within the budget' },
    { id: 'has_observable', label: 'at least one OBSERVABLE_INCLUDE with measurement targets' },
    { id: 'deterministic', label: 'noiseless detectors and observables are deterministic' },
    { id: 'duration', label: 'at least as many measurement rounds as requested' },
    { id: 'decodable', label: 'the detector error model decomposes into a matchable graph' },
    { id: 'nontrivial_observable', label: 'some error mechanism flips the observable' },
    { id: 'fault_distance', label: 'no undetectable logical error lighter than the requested distance' },
  ],
  state_synthesis: [
    { id: 'ir_conversion', label: 'elementary gates only (no initialize, StatePreparation, unitary or isometry)' },
    { id: 'gate_set', label: 'only allowed gates' },
    { id: 'qubit_count', label: 'exactly the requested number of qubits' },
    { id: 'no_measurement', label: 'no measurements' },
    { id: 'parameter_budget', label: 'at most 128 free parameters' },
  ],
  vqe_ground_state: [
    { id: 'ir_conversion', label: 'elementary gates only' },
    { id: 'qubit_count', label: 'exactly the requested number of qubits' },
    { id: 'parameter_budget', label: 'parameter count within the budget' },
    { id: 'has_parameters', label: 'the circuit has free parameters' },
    { id: 'trainability_prefilter', label: 'gradient variance at initialization is not vanishing (barren plateau)' },
  ],
  trainability_frontier: [
    { id: 'ir_conversion', label: 'the circuit converts at every qubit count' },
    { id: 'ppe_class', label: 'single-Pauli rotations with independent parameters; fixed gates are Clifford' },
    { id: 'qubit_count', label: 'exactly n qubits at each size' },
    { id: 'parameter_budget', label: 'parameter count within the per-qubit budget' },
    { id: 'nontrivial_variance', label: 'gradient variance depends on the parameters' },
    { id: 'nontrivial_algebra', label: 'the dynamical Lie algebra is larger than a product circuit' },
    { id: 'exactness', label: 'Pauli-propagation estimates are tight enough to trust' },
  ],
};

export function guardrailsFor(kind: DiscoveryEvaluatorKind): GuardrailInfo[] {
  return GUARDRAILS[kind] ?? [];
}

export interface SystemPromptInput {
  evaluator: DiscoveryEvaluatorInfo;
  /** The study's description: what the researcher is trying to find. */
  task: string;
  entry: string;
}

export function buildSystemPrompt(input: SystemPromptInput): SystemBlock[] {
  const { evaluator, task, entry } = input;
  const objectives = evaluator.objectives
    .map((o) => `- ${o.key} (${o.direction}${o.unit ? `, ${o.unit}` : ''}): ${o.label}`)
    .join('\n');
  const descriptors = evaluator.descriptors
    .map((d) => `- ${d.key}: ${d.label}, range ${d.min} to ${d.max}`)
    .join('\n');
  const guardrails = guardrailsFor(evaluator.kind)
    .map((g) => `- ${g.id}: ${g.label}`)
    .join('\n');

  const text = [
    'You are a quantum-computing research collaborator working inside an evolutionary program search. You propose small, well-motivated edits to a Python program that builds a quantum circuit. A trusted evaluator that you cannot see or influence scores every candidate, and the search keeps what scores best.',
    '',
    `## Task\n${task.trim() || 'Improve the program on the evaluator objectives below.'}`,
    '',
    `## Evaluator: ${evaluator.title} (${evaluator.kind} v${evaluator.version})\n${evaluator.description.trim()}`,
    `The program must define \`${entry}\`: ${evaluator.entry_signature}`,
    'Fitness is higher-is-better and uses a pessimistic confidence bound, so noisy lucky results do not pay.',
    '',
    `### Objectives\n${objectives || '- (none declared)'}`,
    '',
    `### Descriptors (how candidates are binned for diversity)\n${descriptors || '- (none declared)'}`,
    '',
    `## Guardrails checked on every candidate (a failure rejects it)\n${guardrails || '- (none declared)'}`,
    '',
    '## Rules',
    `- Edit only inside the ${EVOLVE_START_MARKER} ... ${EVOLVE_END_MARKER} block. Never touch, move or mention the markers, and never edit outside the block.`,
    '- Emit your change by calling the propose_program_edit tool with SEARCH/REPLACE edits. Each `search` must be copied verbatim from the parent program (same indentation) and must match exactly once.',
    '- Never add noise, error channels or measurements the task does not ask for. The evaluator applies any noise itself.',
    '- Never read, import, guess or hardcode evaluator internals, seeds, scores or targets. Do not special-case the evaluation. Edits that game the scorer are rejected and wasted.',
    '- Make one small, testable hypothesis per proposal, state it in the rationale, and say what effect you expect on which objective.',
    '- Prefer ideas that differ from the inspirations over copying them, but reuse what demonstrably worked.',
  ].join('\n');

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

// ── User prompt ────────────────────────────────────────────────────────

export interface PromptCandidate {
  id: string;
  program: string;
  evaluation: DiscoveryEvaluation | null;
}

export interface RejectionReason {
  guardrail: string;
  message: string;
  count: number;
}

interface UserPromptInput {
  parent: PromptCandidate;
  inspirations: PromptCandidate[];
  rejections: RejectionReason[];
  generation: number;
  generations: number;
  island: number;
  islands: number;
  bestFitness: number | null;
}

/** Group rejection records by guardrail+message, most frequent first. */
export function summarizeRejections(
  rejections: ReadonlyArray<{ guardrail: string; message: string }>,
  limit = REJECTION_REASONS_SHOWN,
): RejectionReason[] {
  const counts = new Map<string, RejectionReason>();
  for (const r of rejections) {
    const key = `${r.guardrail}\u0000${r.message}`;
    const prior = counts.get(key);
    counts.set(key, prior ? { ...prior, count: prior.count + 1 } : { ...r, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.guardrail.localeCompare(b.guardrail)).slice(0, limit);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  return abs !== 0 && (abs < 1e-3 || abs >= 1e5) ? value.toExponential(3) : String(Number(value.toPrecision(5)));
}

function formatObjective(key: string, o: ObjectiveValue): string {
  const ci = o.ci95 ? ` (95% CI ${formatNumber(o.ci95[0])} to ${formatNumber(o.ci95[1])})` : '';
  return `${key} = ${formatNumber(o.value)}${ci} [${o.direction}]`;
}

export function summarizeEvaluation(evaluation: DiscoveryEvaluation | null): string {
  if (!evaluation) return 'not evaluated yet';
  const lines: string[] = [`status: ${evaluation.status}`];
  if (evaluation.fitness !== null) lines.push(`fitness: ${formatNumber(evaluation.fitness)} (higher is better)`);
  for (const [key, o] of Object.entries(evaluation.objectives)) lines.push(formatObjective(key, o));
  const descriptors = Object.entries(evaluation.descriptors);
  if (descriptors.length > 0) {
    lines.push(`descriptors: ${descriptors.map(([k, v]) => `${k}=${formatNumber(v)}`).join(', ')}`);
  }
  const warnings = evaluation.guardrails.filter((g) => g.status === 'warn');
  for (const g of warnings) lines.push(`guardrail warning ${g.id}: ${g.detail ?? g.label}`);
  if (evaluation.rejection) lines.push(`rejected by ${evaluation.rejection.guardrail}: ${evaluation.rejection.message}`);
  return lines.map((l) => `- ${l}`).join('\n');
}

export function truncateProgram(program: string, maxLines: number): { text: string; note: string } {
  const lines = program.replace(/\n$/, '').split('\n');
  if (lines.length <= maxLines) return { text: lines.join('\n'), note: '' };
  return {
    text: lines.slice(0, maxLines).join('\n'),
    note: `(showing ${maxLines} of ${lines.length} lines)`,
  };
}

export function fence(code: string): string {
  return ['```python', code, '```'].join('\n');
}

/** Addendum §C section; empty string when the parent has no gradient map. */
export function gradientMapSection(map: GradientMap | undefined, parentProgram: string): string {
  if (!map || map.lines.length === 0) return '';
  const source = parentProgram.split('\n');
  const dead = deadGradientLines(map);
  const deadSet = new Set(dead.map((l) => l.line));
  const ordered = [
    ...[...map.lines].filter((l) => deadSet.has(l.line)).sort((a, b) => a.line - b.line),
    ...[...map.lines].filter((l) => !deadSet.has(l.line)).sort((a, b) => a.variance - b.variance),
  ];
  const shown = ordered.slice(0, GRADIENT_MAP_MAX_LINES);
  const rows = shown.map((l) => {
    const text = (source[l.line - 1] ?? '').trim();
    const params = l.parameters.length > 0 ? ` params ${l.parameters.join(', ')}` : '';
    return `- line ${l.line}${l.dead ? ' [DEAD]' : ''}: variance ${formatNumber(l.variance)}${params}${text ? `  | ${text}` : ''}`;
  });
  const out = [
    '### Gradient map (from the trusted evaluator)',
    `Method: ${map.method}, ${map.n_qubits} qubits. ${dead.length} of ${map.lines.length} mapped lines are dead (gradient variance below 1e-8); ${(map.dead_fraction * 100).toFixed(0)}% of parameters are dead.`,
    `(showing ${shown.length} of ${map.lines.length} lines; dead lines first)`,
    ...rows,
  ];
  if (dead.length > 0) {
    out.push(
      `Dead lines (${dead.map((l) => l.line).join(', ')}) contribute nothing the optimizer can use. Consider pruning them, reordering them, or changing their rotation axis so they carry gradient.`,
    );
  }
  return out.join('\n');
}

export function buildUserPrompt(input: UserPromptInput): string {
  const { parent, inspirations, rejections, generation, generations, island, islands, bestFitness } = input;
  const parentView = truncateProgram(parent.program, PARENT_MAX_LINES);
  const parts: string[] = [
    `## Context\nGeneration ${generation} of ${generations}, island ${island + 1} of ${islands}. Best fitness so far: ${bestFitness === null ? 'none yet' : formatNumber(bestFitness)}.`,
    `## Parent program (${parent.id})${parentView.note ? ` ${parentView.note}` : ''}\n${fence(parentView.text)}`,
    `## Parent evaluation\n${summarizeEvaluation(parent.evaluation)}`,
  ];
  const gradient = gradientMapSection(parent.evaluation?.metrics.gradient_map, parent.program);
  if (gradient) parts.push(gradient);

  if (inspirations.length > 0) {
    const blocks = inspirations.map((insp) => {
      const view = truncateProgram(insp.program, INSPIRATION_MAX_LINES);
      const fitness = insp.evaluation?.fitness;
      return [
        `### Inspiration ${insp.id} (fitness ${fitness === null || fitness === undefined ? 'n/a' : formatNumber(fitness)})${view.note ? ` ${view.note}` : ''}`,
        fence(view.text),
        summarizeEvaluation(insp.evaluation),
      ].join('\n');
    });
    parts.push(`## Inspirations (other high-scoring programs from the archive)\n${blocks.join('\n\n')}`);
  }

  if (rejections.length > 0) {
    const rows = rejections.map((r) => `- ${r.guardrail} (x${r.count}): ${r.message}`);
    parts.push(`## Recent rejections in this run (avoid these)\n${rows.join('\n')}`);
  }

  parts.push(
    'Propose one edit to the parent program by calling propose_program_edit. Keep it small and testable.',
  );
  return parts.join('\n\n');
}
