import type { CircuitSnapshot, Gate } from '../../types/quantum';
import type { QecSnapshot, QecDecodeSampleResult } from '../../types/qec';

/**
 * PRD 10 Phase D — pure geometry/layout for the QEC viz panels.
 *
 * All the correctness-critical shaping lives here (coordinate normalization,
 * measure-qubit classification, detector-graph layout, decode overlay), so
 * the SVG components stay thin and the logic is exhaustively testable without
 * a DOM. No React, no D3 side effects.
 */

// ─────────────────────────── Code lattice ───────────────────────────

export type StabilizerBasis = 'X' | 'Z' | 'unknown';

export interface LatticeQubit {
  index: number;
  /** Normalized [0,1] position within the lattice viewbox. */
  x: number;
  y: number;
  /** Raw stim coordinate (for tooltips). */
  raw: [number, number];
  kind: 'data' | 'measure';
  /** For measure qubits: the stabilizer basis inferred from its measurement. */
  basis: StabilizerBasis;
}

const MEASURE_TYPES = new Set(['Measure', 'MR', 'MX', 'MY', 'MZ', 'MRX', 'MRY', 'MRZ']);
// Reset-measure gates mark the STABILIZER/ANCILLA qubits: they are measured
// and reset every syndrome round. Data qubits, by contrast, are only measured
// once at the very end (a plain `M`), so "ever measured" would misclassify
// them — the reset-measure distinction is what separates data from ancilla.
const ANCILLA_TYPES = new Set(['MR', 'MRX', 'MRY', 'MRZ']);
const X_ANCILLA_TYPES = new Set(['MRX']);

/** Qubit indices that are ever measured (any measurement gate). */
export function measureQubits(gates: Gate[]): Set<number> {
  const out = new Set<number>();
  for (const g of gates) {
    if (MEASURE_TYPES.has(g.type)) for (const q of g.targets) out.add(q);
  }
  return out;
}

/** Stabilizer/ancilla qubits — those measured-and-reset each round. */
export function ancillaQubits(gates: Gate[]): Set<number> {
  const out = new Set<number>();
  for (const g of gates) {
    if (ANCILLA_TYPES.has(g.type)) for (const q of g.targets) out.add(q);
  }
  return out;
}

/** Infer each ancilla qubit's stabilizer basis from its reset-measure gate
 * (MRX ⇒ X; MR/MRZ ⇒ Z; mixed ⇒ 'unknown'). */
function inferBases(gates: Gate[]): Map<number, StabilizerBasis> {
  const seen = new Map<number, StabilizerBasis>();
  for (const g of gates) {
    if (!ANCILLA_TYPES.has(g.type)) continue;
    const basis: StabilizerBasis = X_ANCILLA_TYPES.has(g.type) ? 'X' : 'Z';
    for (const q of g.targets) {
      const prev = seen.get(q);
      seen.set(q, prev === undefined || prev === basis ? basis : 'unknown');
    }
  }
  return seen;
}

export interface LatticeLayout {
  qubits: LatticeQubit[];
  /** True when the circuit carries qubit coordinates (else the panel hides). */
  hasCoordinates: boolean;
}

/** Build the code-lattice layout: qubit positions normalized to [0,1],
 * classified data/measure, measure qubits tagged with their basis. */
export function latticeLayout(qec: QecSnapshot, snapshot: CircuitSnapshot | null): LatticeLayout {
  const coords = qec.coords.qubits;
  const present = coords
    .map((c, index) => ({ index, c }))
    .filter((e): e is { index: number; c: [number, number] } => e.c !== null);
  if (present.length === 0) return { qubits: [], hasCoordinates: false };

  const xs = present.map((e) => e.c[0]);
  const ys = present.map((e) => e.c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const ancillas = ancillaQubits(snapshot?.gates ?? []);
  const bases = inferBases(snapshot?.gates ?? []);

  const qubits = present.map(({ index, c }) => ({
    index,
    x: (c[0] - minX) / spanX,
    y: (c[1] - minY) / spanY,
    raw: c,
    kind: ancillas.has(index) ? ('measure' as const) : ('data' as const),
    basis: ancillas.has(index) ? (bases.get(index) ?? 'unknown') : ('unknown' as const),
  }));

  return { qubits, hasCoordinates: true };
}

/** Qubit indices active (touched by a gate) at a given tick/layer, for the
 * lattice tick-scrubber highlight. */
export function activeQubitsAtTick(gates: Gate[], tick: number): Set<number> {
  const out = new Set<number>();
  for (const g of gates) {
    if (g.layer !== tick) continue;
    for (const q of g.targets) out.add(q);
    for (const c of g.controls ?? []) out.add(c);
  }
  return out;
}

// ─────────────────────────── Detector graph ───────────────────────────

export interface DetectorNode {
  detector: number;
  x: number;
  y: number;
}

export interface DetectorGraphEdge {
  /** Detector index, or -1 for the virtual boundary node. */
  a: number;
  b: number;
  p: number;
  obs: number[];
}

export interface DetectorGraphLayout {
  nodes: DetectorNode[];
  /** The virtual boundary node position ([0,1] space). */
  boundary: { x: number; y: number };
  edges: DetectorGraphEdge[];
  /** True when detector coordinates drove the layout (else a circle fallback). */
  hasCoordinates: boolean;
}

/** Deterministic circular fallback position for detector i of n. */
function circlePosition(i: number, n: number): { x: number; y: number } {
  if (n <= 1) return { x: 0.5, y: 0.5 };
  const angle = (2 * Math.PI * i) / n - Math.PI / 2;
  return { x: 0.5 + 0.42 * Math.cos(angle), y: 0.5 + 0.42 * Math.sin(angle) };
}

/**
 * Lay out the detector graph: nodes positioned by their (x, y) detector
 * coordinates when present (normalized to [0,1]), else on a deterministic
 * circle. Boundary edges attach to a virtual node placed below the graph.
 * Returns null-safe empty layout when there is no DEM.
 */
export function detectorGraphLayout(qec: QecSnapshot): DetectorGraphLayout {
  const dem = qec.dem;
  const n = qec.num_detectors;
  const coords = qec.coords.detectors;
  const present = coords.filter((c): c is [number, number, number] => c !== null);
  const hasCoordinates = present.length === n && n > 0;

  let nodes: DetectorNode[];
  if (hasCoordinates) {
    const xs = present.map((c) => c[0]);
    const ys = present.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    nodes = coords.map((c, detector) => {
      const cc = c as [number, number, number];
      return {
        detector,
        x: 0.05 + 0.9 * ((cc[0] - minX) / spanX),
        y: 0.05 + 0.85 * ((cc[1] - minY) / spanY),
      };
    });
  } else {
    nodes = Array.from({ length: n }, (_, detector) => ({ detector, ...circlePosition(detector, n) }));
  }

  const edges: DetectorGraphEdge[] = [];
  if (dem) {
    for (const e of dem.edges) edges.push({ a: e.d1, b: e.d2, p: e.p, obs: e.obs });
    for (const e of dem.boundary_edges) edges.push({ a: e.d, b: -1, p: e.p, obs: e.obs });
  }

  return { nodes, boundary: { x: 0.5, y: 0.97 }, edges, hasCoordinates };
}

// ─────────────────────────── Decode overlay ───────────────────────────

export interface DecodeOverlay {
  firedDetectors: Set<number>;
  /** Matched edges as (a,b) pairs; b = -1 for a boundary match. */
  matchedEdges: Array<{ a: number; b: number }>;
  logicalError: boolean;
}

/** Reduce a decode sample into the overlay the detector graph highlights:
 * fired detectors, the decoder's matching, and whether the prediction missed
 * the actual logical flip (a logical error this shot). */
export function decodeOverlay(sample: QecDecodeSampleResult): DecodeOverlay {
  const fired = new Set(sample.syndrome);
  const matched = sample.matched_edges.map((e) => ({ a: e.d1, b: e.d2 ?? -1 }));
  const predicted = sample.predicted_observable_flips;
  const actual = sample.actual_observable_flips;
  const logicalError = predicted.some((v, i) => (v ? 1 : 0) !== (actual[i] ?? 0));
  return { firedDetectors: fired, matchedEdges: matched, logicalError };
}

// ─────────────────────────── Timeline styling ───────────────────────────

export interface TimelineGate extends Gate {
  gateIndex: number;
  /** NOISE:<kind> gates carry a hazard style + probability. */
  isNoise: boolean;
  noiseKind: string | null;
  probability: number | null;
  isDetector: boolean;
  isObservable: boolean;
}

/** Classify the mapped stim gates for the timeline: noise ops (hazard tint +
 * probability), detector/observable markers, and ordinary gates. Preserves
 * order and the moment (layer = tick) each gate sits in. */
export function classifyTimelineGates(gates: Gate[]): TimelineGate[] {
  return gates.map((g, gateIndex) => {
    const isNoise = g.type.startsWith('NOISE:');
    return {
      ...g,
      gateIndex,
      isNoise,
      noiseKind: isNoise ? g.type.slice('NOISE:'.length) : null,
      probability: isNoise && g.params.length > 0 ? g.params[0] : null,
      isDetector: g.type === 'DETECTOR',
      isObservable: g.type === 'OBSERVABLE',
    };
  });
}

/** The DETECTOR/OBSERVABLE markers grouped by tick, for the bottom track. */
export function detectorTrackByTick(gates: Gate[]): Map<number, TimelineGate[]> {
  const byTick = new Map<number, TimelineGate[]>();
  for (const g of classifyTimelineGates(gates)) {
    if (!g.isDetector && !g.isObservable) continue;
    const list = byTick.get(g.layer) ?? [];
    list.push(g);
    byTick.set(g.layer, list);
  }
  return byTick;
}
