/**
 * PRD 14 §3.3 — Dirac context for the Trainability Lab. Pure and capped:
 * every list that is truncated says "N of M", so Dirac (and the user reading
 * the transcript) always knows what was left out. Research mode only; the
 * caller guards that (see `useDirac.buildContextBlock`).
 */

import { formatSci } from '../../components/lab/chartUtils';
import type {
  TrainabilityDiagnostic,
  TrainabilityInspection,
  TrainabilityJobRecord,
} from '../../types/trainability';
import { deriveSimulabilityVerdict, deriveTrainabilityVerdict, primaryFit } from './verdict';

export const CONTEXT_CAPS = Object.freeze({
  parameters: 8,
  diagnostics: 6,
  scalingPoints: 8,
  evidence: 5,
  maxChars: 4000,
});

export interface TrainabilityContextInput {
  fileName: string | null;
  observable: string;
  inspection: TrainabilityInspection | null;
  job: TrainabilityJobRecord | null;
  diagnostics: readonly TrainabilityDiagnostic[];
  /** True when the latest job analysed older code than the editor holds. */
  stale?: boolean;
}

function capped<T>(items: readonly T[], cap: number): { shown: T[]; note: string } {
  const shown = items.slice(0, cap);
  return { shown, note: items.length > cap ? ` (showing ${shown.length} of ${items.length})` : '' };
}

const sci = (v: number | null | undefined) => formatSci(v, 3);

function lines(input: TrainabilityContextInput): string[] {
  const { inspection, job, diagnostics } = input;
  const out: string[] = [];
  out.push(`- File: ${input.fileName ?? 'untitled'}; observable: ${input.observable}`);
  if (inspection) {
    out.push(`- Circuit: ${inspection.n_qubits} qubits, ${inspection.parameters.length} free parameters, ${inspection.gate_count} gates (${inspection.framework})`);
    if (inspection.sweepable_params.length > 0) out.push(`- Sweepable params: ${inspection.sweepable_params.join(', ')}`);
  }

  if (diagnostics.length > 0) {
    const { shown, note } = capped(diagnostics, CONTEXT_CAPS.diagnostics);
    out.push(`- Lint diagnostics${note}:`);
    for (const d of shown) out.push(`  - ${d.code} [${d.severity}] ${d.title}${d.line !== null ? ` (line ${d.line})` : ''}`);
  }

  if (!job) return out;
  out.push(`- Latest analysis: ${job.status}${input.stale ? ' (the code has changed since; results may be stale)' : ''}`);
  const trainability = deriveTrainabilityVerdict(job.results, diagnostics);
  out.push(`- Barren-plateau risk: ${trainability.risk}`);
  const evidence = capped(trainability.evidence, CONTEXT_CAPS.evidence);
  for (const e of evidence.shown) out.push(`  - [${e.level}] ${e.text}`);
  if (evidence.note) out.push(`  -${evidence.note}`);

  const g = job.results.gradients;
  if (g) {
    out.push(`- Gradients (${g.method ?? 'sampling'}, ${g.samples} samples): mean variance ${sci(g.variance_mean)}`);
    const ranked = [...g.per_parameter].sort((a, b) => a.variance - b.variance);
    const { shown, note } = capped(ranked, CONTEXT_CAPS.parameters);
    out.push(`  - lowest-variance parameters${note}: ${shown.map((p) => `${p.name}=${sci(p.variance)}`).join(', ')}`);
  }
  const fit = primaryFit(job.results.scaling?.fits);
  if (fit) {
    out.push(`- Scaling: ${fit.verdict.replace('_', ' ')} — ${fit.summary}`);
    const points = job.results.scaling?.points ?? [];
    const { shown, note } = capped(points, CONTEXT_CAPS.scalingPoints);
    out.push(`  - points${note}: ${shown.map((p) => `n=${p.n_qubits}:${sci(p.variance)}`).join(', ')}`);
  }
  const lie = job.results.lie;
  if (lie) {
    out.push(`- Lie algebra (${lie.status}): dim 𝔤 ${lie.dimension ?? `≥ ${lie.dimension_lower_bound}`}${lie.classification ? `, ${lie.classification.label}` : ''}`);
    out.push(`  - ${lie.simulability.summary}`);
  }
  if (job.results.expressibility) out.push(`- Expressibility KL to Haar: ${sci(job.results.expressibility.kl)}`);
  if (job.results.entanglement) {
    out.push(`- Meyer–Wallach mean ${sci(job.results.entanglement.mean)} (Haar ${sci(job.results.entanglement.haar_mean)})`);
  }
  const failed = Object.keys(job.errors);
  if (failed.length > 0) out.push(`- Failed analyses: ${failed.join(', ')}`);
  const sim = deriveSimulabilityVerdict(job.results);
  if (sim.ppe.used) out.push(`- ${sim.caveat}`);
  return out;
}

/** Returns an empty string when there is nothing worth telling Dirac. */
export function buildTrainabilityContext(input: TrainabilityContextInput): string {
  const parameterized = (input.inspection?.parameters.length ?? 0) > 0;
  if (!input.job && !parameterized && input.diagnostics.length === 0) return '';
  const body = lines(input).join('\n');
  const text = `## Trainability Lab\n${body}`;
  if (text.length <= CONTEXT_CAPS.maxChars) return text;
  return `${text.slice(0, CONTEXT_CAPS.maxChars - 40).trimEnd()}\n- (context truncated at ${CONTEXT_CAPS.maxChars} characters)`;
}
