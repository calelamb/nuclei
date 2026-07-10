import type { BackendInfo } from '../../types/hardware';
import type { CircuitSnapshot } from '../../types/quantum';

// ---------------------------------------------------------------------------
// Pure, side-effect-free hardware planner. Given a parsed circuit and the set
// of backends the app currently knows about, recommends a compatible backend
// with an explainable, weighted score. SHADOW MODE ONLY: nothing here submits
// a job, talks to a provider, or calls the kernel — it is analysis over data
// already in hand.
// ---------------------------------------------------------------------------

export interface CompatibilityResult {
  backend: BackendInfo;
  compatible: boolean;
  reasons: string[];
}

// Measurement and barrier operations are considered universally available —
// every backend that can run gates can also measure and place barriers, so
// flagging them as "unsupported" would only produce false rejections.
const ALWAYS_AVAILABLE_RE = /^(measure|m|mz|mresetz|barrier)$/i;

// Canonical gate-name synonyms so a backend that advertises one spelling
// (e.g. `cx`) is correctly recognized as covering the other (e.g. `CNOT`).
const GATE_SYNONYM_GROUPS: string[][] = [
  ['CNOT', 'CX'],
  ['TOFFOLI', 'CCX'],
  ['PHASE', 'P'],
];

function equivalentGateNames(gateType: string): string[] {
  const upper = gateType.toUpperCase();
  const group = GATE_SYNONYM_GROUPS.find((names) => names.includes(upper));
  return group ?? [upper];
}

/** Distinct canonical (uppercased) gate types used by the circuit, excluding
 * measurement/barrier operations which are always considered available. */
function usedGateTypes(snapshot: CircuitSnapshot): string[] {
  const types = new Set<string>();
  for (const gate of snapshot.gates) {
    if (ALWAYS_AVAILABLE_RE.test(gate.type)) continue;
    types.add(gate.type.toUpperCase());
  }
  return Array.from(types);
}

/** Gate-set coverage reasons. Conservative by design: an empty/unknown
 * gateSet never produces a rejection — only a backend that explicitly
 * advertises a gate set AND clearly lacks a used gate is flagged. */
function gateSetReasons(snapshot: CircuitSnapshot, backend: BackendInfo): string[] {
  if (backend.gateSet.length === 0) return [];

  const advertised = new Set(backend.gateSet.map((g) => g.toUpperCase()));
  const reasons: string[] = [];

  for (const used of usedGateTypes(snapshot)) {
    const covered = equivalentGateNames(used).some((name) => advertised.has(name));
    if (!covered) {
      reasons.push(`gate ${used} is not in this backend's advertised gate set`);
    }
  }

  return reasons;
}

/** Hard-filters backends against a parsed circuit: qubit count, online
 * status, and gate-set coverage. Every rejection carries a plain-English
 * reason so the caller (and the model) can explain the decision. */
export function filterCompatible(snapshot: CircuitSnapshot, backends: BackendInfo[]): CompatibilityResult[] {
  return backends.map((backend) => {
    const reasons: string[] = [];

    if (backend.qubitCount < snapshot.qubit_count) {
      reasons.push(`needs ${snapshot.qubit_count} qubits, backend has ${backend.qubitCount}`);
    }
    if (backend.status !== 'online') {
      reasons.push(`backend is ${backend.status}`);
    }
    reasons.push(...gateSetReasons(snapshot, backend));

    return { backend, compatible: reasons.length === 0, reasons };
  });
}

export interface ScoreFactor {
  name: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface BackendScore {
  score: number;
  factors: ScoreFactor[];
}

// Named weights for each scoring factor. Sum to 1.0 so `score` reads as a
// weighted-average style number in roughly [0, 1] (contributions are rounded
// individually, so the total may drift by a fraction of a rounding unit).
export const QUEUE_WEIGHT = 0.35;
export const ERROR_RATE_WEIGHT = 0.35;
export const QUBIT_HEADROOM_WEIGHT = 0.2;
export const STATUS_WEIGHT = 0.1;

// Saturation constants: how quickly each raw metric's normalized factor
// approaches its limit. Chosen so typical values (a queue of a few dozen
// jobs, a handful of spare qubits) land in the middle of [0, 1] rather than
// pinned at an extreme.
const QUEUE_SATURATION = 20; // queueLength at which the queue factor is 0.5
const QUBIT_HEADROOM_SATURATION = 4; // spare qubits at which the headroom factor is 0.5

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Lower queue length is better; saturates toward 1 as the queue shortens
 * and decays toward 0 as it grows, never going negative. */
function queueFactor(queueLength: number): number {
  return QUEUE_SATURATION / (QUEUE_SATURATION + Math.max(0, queueLength));
}

/** Lower error rate is better. averageErrorRate is expected in [0, 1]; the
 * factor is clamped defensively in case of out-of-range input. */
function errorRateFactor(averageErrorRate: number): number {
  return clamp01(1 - averageErrorRate);
}

/** More spare qubits (beyond what the circuit needs) is better, saturating
 * so a backend with vastly more qubits than needed doesn't dominate purely
 * on headroom. */
function qubitHeadroomFactor(snapshot: CircuitSnapshot, backend: BackendInfo): number {
  const spare = Math.max(0, backend.qubitCount - snapshot.qubit_count);
  return spare / (spare + QUBIT_HEADROOM_SATURATION);
}

function statusFactor(backend: BackendInfo): number {
  return backend.status === 'online' ? 1 : 0;
}

/** Computes an explainable, weighted score for a single backend against a
 * parsed circuit. Higher is better. Pure — no notion of which backends were
 * filtered; callers typically score only backends that already passed
 * filterCompatible. */
export function scoreBackend(snapshot: CircuitSnapshot, backend: BackendInfo): BackendScore {
  const raw: Array<[name: string, value: number, weight: number]> = [
    ['queue', queueFactor(backend.queueLength), QUEUE_WEIGHT],
    ['errorRate', errorRateFactor(backend.averageErrorRate), ERROR_RATE_WEIGHT],
    ['qubitHeadroom', qubitHeadroomFactor(snapshot, backend), QUBIT_HEADROOM_WEIGHT],
    ['status', statusFactor(backend), STATUS_WEIGHT],
  ];

  const factors: ScoreFactor[] = raw.map(([name, value, weight]) => ({
    name,
    value,
    weight,
    contribution: round4(value * weight),
  }));

  const score = round4(factors.reduce((sum, factor) => sum + factor.contribution, 0));

  return { score, factors };
}

export interface HardwarePlanCandidate {
  backend: BackendInfo;
  score: number;
  factors: ScoreFactor[];
}

export interface HardwarePlanRejected {
  backend: BackendInfo;
  reasons: string[];
}

export interface HardwarePlan {
  candidates: HardwarePlanCandidate[];
  rejected: HardwarePlanRejected[];
  selected: BackendInfo | null;
  rationale: string;
}

function noCandidateRationale(backends: BackendInfo[], rejected: HardwarePlanRejected[]): string {
  if (backends.length === 0) {
    return 'No hardware backends are currently known, so no recommendation can be made.';
  }
  const detail = rejected.map((r) => `${r.backend.name} (${r.reasons.join('; ')})`).join(', ');
  return `None of the ${backends.length} known backend(s) are compatible with this circuit: ${detail}.`;
}

function topPickRationale(top: HardwarePlanCandidate, runnerUp: HardwarePlanCandidate | undefined): string {
  const summary =
    `${top.backend.name} was selected with a score of ${top.score} ` +
    `(queue length ${top.backend.queueLength}, average error rate ${top.backend.averageErrorRate}, ` +
    `${top.backend.qubitCount} qubits available).`;

  if (!runnerUp) {
    return `${summary} It was the only compatible backend available.`;
  }

  return (
    `${summary} It was preferred over the next-best candidate, ${runnerUp.backend.name} ` +
    `(score ${runnerUp.score}), based on a better combination of queue length, error rate, and qubit headroom.`
  );
}

/** Filters backends for compatibility, scores the survivors, and picks the
 * top-scoring one as a shadow-mode recommendation. Pure and deterministic —
 * this never submits anything; it only reasons about the inputs it was
 * given. */
export function planHardwareRun(snapshot: CircuitSnapshot, backends: BackendInfo[]): HardwarePlan {
  const filtered = filterCompatible(snapshot, backends);
  const rejected: HardwarePlanRejected[] = filtered
    .filter((f) => !f.compatible)
    .map((f) => ({ backend: f.backend, reasons: f.reasons }));

  const candidates: HardwarePlanCandidate[] = filtered
    .filter((f) => f.compatible)
    .map((f) => {
      const { score, factors } = scoreBackend(snapshot, f.backend);
      return { backend: f.backend, score, factors };
    })
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { candidates, rejected, selected: null, rationale: noCandidateRationale(backends, rejected) };
  }

  const [top, runnerUp] = candidates;
  return { candidates, rejected, selected: top.backend, rationale: topPickRationale(top, runnerUp) };
}
