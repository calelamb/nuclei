/**
 * PRD 14 addendum §D — Trainability Certificate. Pure: renders the human
 * report (Markdown) and assembles the machine document (JSON) from a
 * finished job. File IO lives in `certificateIo.ts`.
 */

import { formatInterval, formatSci } from '../../components/lab/chartUtils';
import type {
  TrainabilityCertificateJson,
  TrainabilityDiagnostic,
  TrainabilityJobRecord,
} from '../../types/trainability';
import { TRAINABILITY_CITATIONS, type TrainabilityCitation } from './citations';
import { deriveSimulabilityVerdict, deriveTrainabilityVerdict, primaryFit } from './verdict';

export interface CertificateInput {
  job: TrainabilityJobRecord;
  diagnostics: readonly TrainabilityDiagnostic[];
  /** ISO-8601 timestamp; injected so rendering stays deterministic. */
  createdAt: string;
}

export function certificateStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.[^.]+$/, '');
  return stem.replace(/[^\w.-]+/g, '_') || 'untitled';
}

export function certificatePaths(fileName: string): { json: string; markdown: string } {
  const stem = certificateStem(fileName);
  return {
    json: `experiments/${stem}.trainability.json`,
    markdown: `experiments/${stem}.trainability.md`,
  };
}

export function buildCertificateJson({ job, diagnostics, createdAt }: CertificateInput): TrainabilityCertificateJson {
  const trainability = deriveTrainabilityVerdict(job.results, diagnostics);
  const simulability = deriveSimulabilityVerdict(job.results);
  return {
    schema: 'nuclei.trainability.certificate/1',
    file: job.target.fileName,
    framework: job.target.framework,
    n_qubits: job.target.nQubits,
    n_parameters: job.target.nParameters,
    observable: job.provenance?.observable ?? job.target.observable,
    created_at: job.provenance?.created_at ?? createdAt,
    job_id: job.id,
    provenance: job.provenance,
    settings: job.provenance?.settings ?? job.settings,
    verdicts: {
      trainability: { risk: trainability.risk, evidence: trainability.evidence },
      simulability: {
        kind: simulability.kind,
        summary: simulability.summary,
        ppe_points: simulability.ppe.points,
        caveat: simulability.caveat,
      },
      scaling: primaryFit(job.results.scaling?.fits)?.verdict ?? null,
    },
    results: job.results,
    errors: job.errors,
    lint: [...diagnostics],
  };
}

export function serializeCertificateJson(doc: TrainabilityCertificateJson): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const sci = (v: number | null | undefined) => formatSci(v, 3);
const cell = (text: string) => text.replace(/\|/g, '\\|');

function methodLabel(method: string | undefined, backend: string | undefined): string {
  const m = method === 'ppe' ? 'Pauli propagation' : method === 'sampling' ? 'sampling' : 'unspecified';
  return backend ? `${m} (${backend})` : m;
}

/** PPE intervals are rigorous truncation intervals, never confidence intervals. */
function intervalLabel(method: string | undefined): string {
  return method === 'ppe' ? 'truncation interval (rigorous)' : '95% CI (bootstrap)';
}

function table(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
}

function gradientsSection(job: TrainabilityJobRecord): string[] {
  const g = job.results.gradients;
  if (!g) return [];
  const out = [
    '### Gradients',
    '',
    `Method: ${methodLabel(g.method, g.backend)}. Samples: ${g.samples}. Initialization: ${g.init}.`,
    `Mean variance ${sci(g.variance_mean)}, ${intervalLabel(g.method)} ${formatInterval(g.interval ?? g.variance_mean_ci95, 3)}.`,
    `Mean gradient norm ${sci(g.gradient_norm_mean)}.`,
    '',
    ...table(
      ['Parameter', 'Var[∂C/∂θ]', intervalLabel(g.method), 'E|∂C/∂θ|'],
      g.per_parameter.map((p) => [p.name, sci(p.variance), formatInterval(p.variance_ci95, 3), sci(p.abs_mean)]),
    ),
    '',
  ];
  return out;
}

function scalingSection(job: TrainabilityJobRecord): string[] {
  const s = job.results.scaling;
  if (!s) return [];
  const out = ['### Scaling', '', ...table(
    ['n', 'layers', 'params', 'Var[∂C]', 'Interval', 'Interval kind', 'Method'],
    s.points.map((p) => [
      String(p.n_qubits),
      String(p.n_layers),
      String(p.n_params),
      sci(p.variance),
      formatInterval(p.interval ?? p.variance_ci95, 3),
      intervalLabel(p.method),
      methodLabel(p.method, p.backend),
    ]),
  ), ''];
  for (const fit of s.fits) {
    out.push(`**${fit.n_layers} layers — verdict: ${fit.verdict.replace('_', ' ')}.** ${fit.summary}`);
    if (fit.exponential) {
      out.push(
        `- Exponential: β = ${sci(fit.exponential.beta)} (95% CI ${formatInterval(fit.exponential.beta_ci95, 3)}), R² = ${sci(fit.exponential.r2)}, AIC = ${sci(fit.exponential.aic)}.`,
      );
    }
    if (fit.power_law) {
      out.push(
        `- Power law: α = ${sci(fit.power_law.alpha)} (95% CI ${formatInterval(fit.power_law.alpha_ci95, 3)}), R² = ${sci(fit.power_law.r2)}, AIC = ${sci(fit.power_law.aic)}.`,
      );
    }
    out.push(`- Preferred: ${fit.preferred}; ΔAIC = ${sci(fit.delta_aic)}.`, '');
  }
  for (const note of s.notes ?? []) out.push(`- Note: ${note}`);
  if ((s.notes ?? []).length > 0) out.push('');
  return out;
}

function lieSection(job: TrainabilityJobRecord): string[] {
  const l = job.results.lie;
  if (!l) return [];
  const out = [
    '### Lie algebra',
    '',
    `Status: ${l.status}${l.reason ? ` (${l.reason})` : ''}.`,
    `dim 𝔤 = ${l.dimension ?? `≥ ${l.dimension_lower_bound}`} of at most ${l.max_dimension} (n = ${l.n_qubits}).`,
  ];
  if (l.classification) {
    out.push(`Classification: ${l.classification.label} (${l.classification.confidence}). ${l.classification.note}`);
  }
  out.push(
    `g-purity: initial state ${sci(l.purity.initial_state)}, observable ${sci(l.purity.observable)}; observable in 𝔤: ${String(l.purity.observable_in_algebra)}, state in 𝔤: ${String(l.purity.state_in_algebra)}.`,
    `Predicted variance (Ragone et al.): ${sci(l.predicted_variance)}${l.prediction_applicable ? '' : ' (not applicable here)'}.`,
    `Simulability: ${l.simulability.summary}`,
    '',
    'Assumptions:',
    ...l.assumptions.map((a) => `- ${a}`),
    '',
  );
  return out;
}

function distributionSections(job: TrainabilityJobRecord): string[] {
  const out: string[] = [];
  const e = job.results.expressibility;
  if (e) {
    out.push(
      '### Expressibility',
      '',
      `KL divergence to Haar: ${sci(e.kl)} (95% CI ${formatInterval(e.kl_ci95, 3)}) over ${e.pairs} state pairs, ${e.bins} bins, dimension ${e.dimension}.`,
      `Reference: ${e.reference.note} (${sci(e.reference.idle_kl)}).`,
      '',
    );
  }
  const m = job.results.entanglement;
  if (m) {
    out.push(
      '### Entangling capability',
      '',
      `Meyer–Wallach mean ${sci(m.mean)} ± ${sci(m.std)} (95% CI ${formatInterval(m.ci95, 3)}); Haar mean ${sci(m.haar_mean)}.`,
      '',
    );
  }
  const ls = job.results.landscape;
  if (ls) {
    out.push(
      '### Landscape',
      '',
      `${ls.resolution}×${ls.resolution} slice, span ±${sci(ls.span)} rad along two random orthonormal directions. Cost range [${sci(ls.min)}, ${sci(ls.max)}], value at center ${sci(ls.center_value)}.`,
      '',
    );
  }
  return out;
}

function citationsFor(job: TrainabilityJobRecord, diagnostics: readonly TrainabilityDiagnostic[]): TrainabilityCitation[] {
  const ids = new Set<string>(['mcclean2018']);
  if (job.results.gradients || job.results.scaling) ids.add('cerezo2021');
  if (job.results.lie) {
    ids.add('ragone2024');
    ids.add('goh2023');
    ids.add('larocca2023');
  }
  if (job.results.expressibility) ids.add('sim2019');
  if (job.results.entanglement) {
    ids.add('sim2019');
    ids.add('meyer2002');
  }
  const base = TRAINABILITY_CITATIONS.filter((c) => ids.has(c.id));
  const known = new Set(base.map((c) => c.url));
  const extra: TrainabilityCitation[] = [];
  for (const d of diagnostics) {
    if (d.citation && !known.has(d.citation.url)) {
      known.add(d.citation.url);
      extra.push({ id: d.code, label: d.citation.label, url: d.citation.url, supports: `Cited by ${d.code}.` });
    }
  }
  return [...base, ...extra];
}

export function renderCertificateMarkdown(input: CertificateInput): string {
  const { job, diagnostics } = input;
  const doc = buildCertificateJson(input);
  const trainability = deriveTrainabilityVerdict(job.results, diagnostics);
  const simulability = deriveSimulabilityVerdict(job.results);
  const lines: string[] = [
    `# Trainability certificate — ${job.target.fileName}`,
    '',
    `Generated ${doc.created_at} by the Nuclei Trainability Lab (job \`${job.id}\`, status: ${job.status}).`,
    '',
    `- Framework: ${job.target.framework}`,
    `- Qubits: ${job.target.nQubits ?? 'unknown'}; parameters: ${job.target.nParameters ?? 'unknown'}`,
    `- Observable: \`${doc.observable}\``,
    '',
    '## Verdicts',
    '',
    `**Barren-plateau risk: ${trainability.risk.toUpperCase()}**`,
    '',
    ...(trainability.evidence.length > 0
      ? trainability.evidence.map((e) => `- [${e.level}] (${e.source}) ${e.text}`)
      : ['- No evidence yet: run the analyses.']),
    '',
    `**Simulability: ${simulability.kind.replace(/_/g, ' ')}.** ${simulability.summary}`,
    '',
    ...simulability.evidence.map((e) => `- ${e}`),
    `- ${simulability.caveat}`,
    '',
    '## Results',
    '',
    ...gradientsSection(job),
    ...scalingSection(job),
    ...lieSection(job),
    ...distributionSections(job),
  ];

  const failed = Object.entries(job.errors);
  if (failed.length > 0) {
    lines.push('### Analysis errors', '', ...failed.map(([name, err]) => `- ${name}: ${err?.message ?? 'failed'} (${err?.code ?? 'error'})`), '');
  }

  if (diagnostics.length > 0) {
    lines.push(
      '## Lint diagnostics',
      '',
      ...diagnostics.map(
        (d) =>
          `- **${d.code}** (${d.severity}) ${d.title}${d.line !== null ? ` — line ${d.line}` : ''}: ${d.message}${d.citation ? ` [${d.citation.label}](${d.citation.url})` : ''}`,
      ),
      '',
    );
  }

  lines.push(
    '## Citations',
    '',
    ...citationsFor(job, diagnostics).map((c) => `- [${c.label}](${c.url}) — ${c.supports}`),
    '',
    '## Reproduce',
    '',
    `- Code SHA-256: \`${job.provenance?.code_sha256 ?? 'unavailable'}\``,
    `- Seed: ${job.provenance?.settings.seed ?? job.settings.seed ?? 0}`,
    `- Backend: ${job.provenance?.backend ?? 'unspecified'}`,
    `- Analyses fingerprint: \`${job.provenance?.analyses_fingerprint ?? 'unavailable'}\``,
    `- Kernel: protocol ${job.provenance?.kernel.nuclei_protocol ?? '?'}, Python ${job.provenance?.kernel.python ?? '?'}, NumPy ${job.provenance?.kernel.numpy ?? '?'}`,
    '',
    '```json',
    JSON.stringify(job.provenance?.settings ?? job.settings, null, 2),
    '```',
    '',
    'Re-running with the same code, settings and seed on the same backend reproduces every number bit-for-bit.',
    '',
  );
  return lines.join('\n');
}
