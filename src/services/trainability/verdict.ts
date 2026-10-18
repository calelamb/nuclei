/**
 * PRD 14 §3.1 — pure verdict derivation for the verdict rail, the Dirac
 * context and the certificate. Every verdict carries its evidence chain so
 * the UI (and the exported report) can show *why*, per honesty principle 5.
 */

import { formatInterval } from '../../components/lab/chartUtils';
import type {
  LieAlgebraResult,
  TrainabilityDiagnostic,
  TrainabilityResults,
  ScalingFit,
} from '../../types/trainability';
import {
  intervalNounOf,
  isNumber,
  methodDescription,
  relativeWidth,
  validInterval,
} from './intervals';

export type BpRisk = 'high' | 'medium' | 'low' | 'unknown';
export type EvidenceLevel = 'high' | 'medium' | 'low' | 'info';

export interface EvidenceItem {
  source: 'scaling' | 'lie' | 'gradients' | 'lint' | 'circuit';
  level: EvidenceLevel;
  text: string;
}

export interface TrainabilityVerdict {
  risk: BpRisk;
  evidence: EvidenceItem[];
  /** True for a parameter-free circuit: there is nothing to train, so no risk level applies. */
  notApplicable?: boolean;
}

export interface TrainabilityVerdictOptions {
  /** Number of free parameters of the analysed circuit (m). */
  nParameters?: number | null;
}

export interface SimulabilityVerdict {
  /** `g_sim_not_applicable`: the DLA is small, but neither O nor ρ lies in 𝔤. */
  kind: 'g_sim_feasible' | 'g_sim_not_applicable' | 'exponential_dla' | 'unknown';
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

/** Addendum §B mandatory honesty text, verbatim minus its markdown emphasis (the UI prints plain text). */
export const SIMULABILITY_CAVEAT =
  'Hardness is resistance to this Pauli-propagation estimator under this budget. It is not a proof of classical hardness. A high score is a lead to investigate, not a counterexample.';

const LEVEL_RANK: Record<EvidenceLevel, number> = { info: 0, low: 1, medium: 2, high: 3 };

/** The scaling fit for the layer count with the most information (largest n_layers). */
export function primaryFit(fits: readonly ScalingFit[] | undefined): ScalingFit | null {
  if (!fits || fits.length === 0) return null;
  return fits.reduce((best, fit) => (fit.n_layers > best.n_layers ? fit : best), fits[0]);
}

export const NO_PARAMETERS_TEXT =
  'This circuit has no free parameters, so there is nothing to train and barren-plateau risk does not apply.';
export const G_SIM_NOT_APPLICABLE_TEXT = 'Small DLA; 𝔤-sim does not apply to this observable/state';

/**
 * 𝔤-sim (and the Ragone variance formula) need the observable and the initial
 * state to overlap 𝔤. When neither lies in 𝔤, or a 𝔤-purity is exactly 0, a
 * small DLA says nothing about trainability or simulability.
 */
export function gSimNotApplicable(lie: LieAlgebraResult): boolean {
  const { purity } = lie;
  if (purity.observable_in_algebra === false && purity.state_in_algebra === false) return true;
  return purity.initial_state === 0 || purity.observable === 0;
}

/** Drop a leading "Inconclusive:" so the UI never says "Inconclusive: Inconclusive". */
export function stripVerdictPrefix(summary: string | null | undefined): string {
  return (summary ?? '').replace(/^\s*inconclusive\s*[:.\-–—]\s*/i, '').trim();
}

export function deriveTrainabilityVerdict(
  results: TrainabilityResults,
  diagnostics: readonly TrainabilityDiagnostic[] = [],
  options: TrainabilityVerdictOptions = {},
): TrainabilityVerdict {
  if (options.nParameters === 0) {
    return { risk: 'unknown', notApplicable: true, evidence: [{ source: 'circuit', level: 'info', text: NO_PARAMETERS_TEXT }] };
  }
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
      const reason = stripVerdictPrefix(fit.summary);
      evidence.push({ source: 'scaling', level: 'info', text: reason ? `Scaling is inconclusive: ${reason}` : 'Scaling is inconclusive.' });
    }
  }
  const failedPoints = (results.scaling?.points ?? []).filter((p) => p.error).length;
  if (failedPoints > 0) {
    evidence.push({
      source: 'scaling',
      level: 'info',
      text: `${failedPoints} scaling point${failedPoints === 1 ? '' : 's'} failed and ${failedPoints === 1 ? 'is' : 'are'} excluded from the fit.`,
    });
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
      if (gSimNotApplicable(lie)) {
        evidence.push({ source: 'lie', level: 'info', text: G_SIM_NOT_APPLICABLE_TEXT });
      } else {
        theory = 'low';
        evidence.push({ source: 'lie', level: 'low', text: lie.simulability.summary });
      }
    }
  }

  const g = results.gradients;
  if (g) {
    const ci = validInterval(g.variance_mean_ci95);
    const noun = intervalNounOf(g);
    if (!isNumber(g.variance_mean)) {
      const reason = (g.notes ?? []).find((n) => n.trim().length > 0);
      evidence.push({
        source: 'gradients',
        level: 'info',
        text: `Mean gradient variance is unresolved: ${methodDescription(g.method)} returned ${
          ci ? `only a ${noun} ${formatInterval(ci)}` : 'no usable estimate'
        }.${reason ? ` ${reason}` : ''}`,
      });
    } else if (g.variance_mean > 0 && g.variance_mean < 1e-6) {
      evidence.push({
        source: 'gradients',
        level: 'medium',
        text: `Mean gradient variance is very small (${g.variance_mean.toExponential(2)}).`,
      });
    } else {
      const basis = isNumber(g.samples) ? `over ${g.samples} samples` : `from ${methodDescription(g.method)}`;
      evidence.push({
        source: 'gradients',
        level: 'info',
        text: `Mean gradient variance ${g.variance_mean.toExponential(2)} ${basis}.`,
      });
    }
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
  const note = (variance: number | null | undefined, interval: unknown, qubits?: number) => {
    ppePoints += 1;
    if (qubits !== undefined) maxQubits = maxQubits === null ? qubits : Math.max(maxQubits, qubits);
    const w = relativeWidth(variance, interval);
    if (w !== null) worst = worst === null ? w : Math.max(worst, w);
  };
  if (gradients?.method === 'ppe') {
    note(gradients.variance_mean, gradients.variance_mean_ci95);
  }
  for (const p of scalingPoints) {
    if (p.method === 'ppe' && !p.error) note(p.variance, p.variance_ci95, p.n_qubits);
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

  const notApplicable = !!lie && lie.status !== 'unsupported' && lie.simulability.kind === 'g_sim_feasible' && gSimNotApplicable(lie);
  return {
    kind: notApplicable ? 'g_sim_not_applicable' : (lie?.simulability.kind ?? 'unknown'),
    summary: notApplicable
      ? G_SIM_NOT_APPLICABLE_TEXT
      : (lie?.simulability.summary ?? 'Run the Lie algebra analysis to assess classical simulability.'),
    dlaSummary: lie && lie.dimension !== null ? `dim 𝔤 = ${lie.dimension}` : null,
    ppe: { used: ppePoints > 0, points: ppePoints, maxQubits, worstRelativeWidth: worst },
    evidence,
    caveat: SIMULABILITY_CAVEAT,
  };
}
