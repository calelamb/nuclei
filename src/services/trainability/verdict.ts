/**
 * PRD 14 §3.1 — pure verdict derivation for the verdict rail, the Dirac
 * context and the certificate. Every verdict carries its evidence chain so
 * the UI (and the exported report) can show *why*, per honesty principle 5.
 */

import type {
  TrainabilityDiagnostic,
  TrainabilityResults,
  ScalingFit,
} from '../../types/trainability';

export type BpRisk = 'high' | 'medium' | 'low' | 'unknown';
export type EvidenceLevel = 'high' | 'medium' | 'low' | 'info';

export interface EvidenceItem {
  source: 'scaling' | 'lie' | 'gradients' | 'lint';
  level: EvidenceLevel;
  text: string;
}

export interface TrainabilityVerdict {
  risk: BpRisk;
  evidence: EvidenceItem[];
}

export interface SimulabilityVerdict {
  kind: 'g_sim_feasible' | 'exponential_dla' | 'unknown';
  summary: string;
  dlaSummary: string | null;
  ppe: {
    used: boolean;
    points: number;
    maxQubits: number | null;
    /** Largest (interval width / variance) across PPE results, or null. */
    worstRelativeWidth: number | null;
  };
  evidence: string[];
  caveat: string;
}

export const SIMULABILITY_CAVEAT =
  'Estimability is resistance to *this* Pauli-propagation estimator under *this* budget; it is not a proof of classical simulability.';

const LEVEL_RANK: Record<EvidenceLevel, number> = { info: 0, low: 1, medium: 2, high: 3 };

/** The scaling fit for the layer count with the most information (largest n_layers). */
export function primaryFit(fits: readonly ScalingFit[] | undefined): ScalingFit | null {
  if (!fits || fits.length === 0) return null;
  return fits.reduce((best, fit) => (fit.n_layers > best.n_layers ? fit : best), fits[0]);
}

function relWidth(variance: number, interval: [number, number] | undefined): number | null {
  if (!interval || !(variance > 0)) return null;
  return (interval[1] - interval[0]) / variance;
}

export function deriveTrainabilityVerdict(
  results: TrainabilityResults,
  diagnostics: readonly TrainabilityDiagnostic[] = [],
): TrainabilityVerdict {
  const evidence: EvidenceItem[] = [];
  let measured: BpRisk | null = null;

  const fit = primaryFit(results.scaling?.fits);
  if (fit) {
    if (fit.verdict === 'barren_plateau') {
      measured = 'high';
      evidence.push({ source: 'scaling', level: 'high', text: fit.summary });
    } else if (fit.verdict === 'polynomial') {
      measured = 'low';
      evidence.push({ source: 'scaling', level: 'low', text: fit.summary });
    } else {
      evidence.push({ source: 'scaling', level: 'info', text: `Scaling is inconclusive: ${fit.summary}` });
    }
  }

  const lie = results.lie;
  let theory: BpRisk | null = null;
  if (lie) {
    if (lie.status === 'unsupported') {
      evidence.push({ source: 'lie', level: 'info', text: `Lie-algebra analysis unsupported${lie.reason ? `: ${lie.reason}` : '.'}` });
    } else if (lie.simulability.kind === 'exponential_dla') {
      theory = lie.status === 'complete' ? 'high' : 'medium';
      evidence.push({
        source: 'lie',
        level: lie.status === 'complete' ? 'high' : 'medium',
        text: `${lie.simulability.summary}${lie.status === 'truncated' ? ` (truncated: dim 𝔤 ≥ ${lie.dimension_lower_bound})` : ''}`,
      });
    } else if (lie.simulability.kind === 'g_sim_feasible') {
      theory = 'low';
      evidence.push({ source: 'lie', level: 'low', text: lie.simulability.summary });
    }
  }

  const g = results.gradients;
  if (g && g.variance_mean > 0 && g.variance_mean < 1e-6) {
    evidence.push({
      source: 'gradients',
      level: 'medium',
      text: `Mean gradient variance is very small (${g.variance_mean.toExponential(2)}).`,
    });
  } else if (g) {
    evidence.push({
      source: 'gradients',
      level: 'info',
      text: `Mean gradient variance ${g.variance_mean.toExponential(2)} over ${g.samples} samples.`,
    });
  }

  let lintLevel: EvidenceLevel | null = null;
  for (const d of diagnostics) {
    if (d.code === 'TRN001' || d.code === 'TRN002') {
      lintLevel = 'medium';
      evidence.push({ source: 'lint', level: 'medium', text: `${d.code} ${d.title}: ${d.message}` });
    }
  }

  let risk: BpRisk;
  if (measured !== null) {
    risk = measured === 'low' && lintLevel ? 'medium' : measured;
  } else if (theory !== null) {
    risk = theory;
  } else if (lintLevel) {
    risk = 'medium';
  } else {
    risk = 'unknown';
  }
  evidence.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  return { risk, evidence };
}

export function deriveSimulabilityVerdict(results: TrainabilityResults): SimulabilityVerdict {
  const lie = results.lie;
  const gradients = results.gradients;
  const scalingPoints = results.scaling?.points ?? [];

  let ppePoints = 0;
  let maxQubits: number | null = null;
  let worst: number | null = null;
  const note = (variance: number, interval?: [number, number], qubits?: number) => {
    ppePoints += 1;
    if (qubits !== undefined) maxQubits = maxQubits === null ? qubits : Math.max(maxQubits, qubits);
    const w = relWidth(variance, interval);
    if (w !== null) worst = worst === null ? w : Math.max(worst, w);
  };
  if (gradients?.method === 'ppe') {
    note(gradients.variance_mean, gradients.interval ?? gradients.variance_mean_ci95);
  }
  for (const p of scalingPoints) {
    if (p.method === 'ppe') note(p.variance, p.interval ?? p.variance_ci95, p.n_qubits);
  }

  const evidence: string[] = [];
  if (lie && lie.status !== 'unsupported') {
    evidence.push(
      lie.dimension !== null
        ? `dim 𝔤 = ${lie.dimension} (${lie.classification?.label ?? 'unclassified'}, ${lie.status}).`
        : `dim 𝔤 ≥ ${lie.dimension_lower_bound} (${lie.status}).`,
    );
  }
  if (ppePoints > 0) {
    evidence.push(
      `Pauli propagation produced ${ppePoints} variance estimate${ppePoints === 1 ? '' : 's'}${
        maxQubits !== null ? ` up to ${maxQubits} qubits` : ''
      }${worst !== null ? `; worst truncation interval is ${(worst * 100).toFixed(1)}% of the estimate` : ''}.`,
    );
  }

  return {
    kind: lie?.simulability.kind ?? 'unknown',
    summary: lie?.simulability.summary ?? 'Run the Lie algebra analysis to assess classical simulability.',
    dlaSummary: lie && lie.dimension !== null ? `dim 𝔤 = ${lie.dimension}` : null,
    ppe: { used: ppePoints > 0, points: ppePoints, maxQubits, worstRelativeWidth: worst },
    evidence,
    caveat: SIMULABILITY_CAVEAT,
  };
}
