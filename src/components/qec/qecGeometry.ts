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

const CNOT_TYPES = new Set(['CNOT', 'CX']);

/** How each ancilla is used in CNOTs: as the control (X-type check) and/or the target (Z-type check). */
function cnotRoles(gates: Gate[], ancillas: ReadonlySet<number>): Map<number, { control: boolean; target: boolean }> {
  const roles = new Map<number, { control: boolean; target: boolean }>();
  const note = (q: number, role: 'control' | 'target'): void => {
    if (!ancillas.has(q)) return;
    roles.set(q, { control: false, target: false, ...roles.get(q), [role]: true });
  };
  for (const g of gates) {
    if (!CNOT_TYPES.has(g.type)) continue;
    for (const c of g.controls ?? []) note(c, 'control');
    for (const t of g.targets) note(t, 'target');
  }
  return roles;
}

/**
 * Infer each ancilla qubit's stabilizer basis. An explicit MRX says X. Stim's
 * generated codes use plain MR with H around X-type ancillas, so the CNOT role
 * decides: an ancilla that only ever controls CNOTs measures an X stabilizer,
 * one that only ever is a target measures Z, mixed use is 'unknown'. With no
 * CNOT evidence a reset-measure defaults to Z.
 */
function inferBases(gates: Gate[]): Map<number, StabilizerBasis> {
  const ancillas = ancillaQubits(gates);
  const roles = cnotRoles(gates, ancillas);
  const out = new Map<number, StabilizerBasis>();
  for (const q of ancillas) {
    const role = roles.get(q);
    if (!role) { out.set(q, 'Z'); continue; }
    out.set(q, role.control && role.target ? 'unknown' : role.control ? 'X' : 'Z');
  }
  for (const g of gates) {
    if (!X_ANCILLA_TYPES.has(g.type)) continue;
    for (const q of g.targets) out.set(q, 'X');
  }
  return out;
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

/**
 * Number of moments the circuit spans. `num_ticks` counts TICK instructions,
 * which separate moments, so N ticks leave N + 1 columns (layers 0..N); the
 * last one holds the final measurements, detectors and observable.
 */
export function tickMomentCount(numTicks: number, gates: ReadonlyArray<{ layer: number }>): number {
  const maxLayer = gates.reduce((m, g) => Math.max(m, g.layer), -1);
  return Math.max(1, numTicks + 1, maxLayer + 1);
}

// ─────────────────────────── Detector graph ───────────────────────────

export interface DetectorNode {
  detector: number;
  x: number;
  y: number;
  /** Measurement round (the detector's third coordinate); 0 on the circle fallback. */
  t: number;
  /** Source (pre-shear) coordinates, used to recognise time-like edges. */
  sx?: number;
  sy?: number;
}

export interface DetectorGraphEdge {
  /** Detector index, or -1 for the virtual boundary node. */
  a: number;
  b: number;
  p: number;
  obs: number[];
  /** True when both ends sit at the same (x, y) in different rounds. */
  timelike: boolean;
}

export interface DetectorGraphLayout {
  nodes: DetectorNode[];
  /** The virtual boundary node position ([0,1] space). */
  boundary: { x: number; y: number };
  edges: DetectorGraphEdge[];
  /** True when detector coordinates drove the layout (else a circle fallback). */
  hasCoordinates: boolean;
  /** Width / height of the unit box the node positions live in; draw it with ONE uniform scale. */
  aspect: number;
}

/** Fraction of the largest spatial span that the whole round axis is sheared across. */
const ROUND_SHEAR = 0.35;
/** Gap (in spatial-span units) between the graph and the virtual boundary strip. */
const BOUNDARY_GAP = 0.12;

/** Position lookup for the detector-graph renderer. O(1) per edge endpoint
 * instead of the old O(edges·nodes) linear `.find()`. Detector -1 (the virtual
 * boundary) is included so edge drawing never special-cases it. */
export function detectorNodeIndex(
  layout: DetectorGraphLayout,
): Map<number, { x: number; y: number }> {
  const index = new Map<number, { x: number; y: number }>();
  for (const node of layout.nodes) index.set(node.detector, { x: node.x, y: node.y });
  index.set(-1, layout.boundary);
  return index;
}

/**
 * Perceptual cool→hot heat color for an edge's error probability, `t` in
 * [0,1] (typically `p / maxP`). Low-probability edges read as faint slate,
 * mid as the teal brand accent, high-probability "error hotspots" as warm
 * amber-red — so where the code is most fragile is legible at a glance.
 * Returns `[r, g, b]`.
 */
export function edgeHeatColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [78, 106, 130]], // faint slate
    [0.5, [0, 180, 216]], //  teal accent
    [1.0, [244, 120, 60]], // warm hotspot
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i][0] && clamped <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const f = (clamped - lo[0]) / span;
  return [
    Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f),
    Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f),
    Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f),
  ];
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

  const placed = hasCoordinates ? shearedNodes(coords as Array<[number, number, number]>) : circleNodes(n);
  const nodeByDetector = new Map(placed.nodes.map((node) => [node.detector, node]));

  const edges: DetectorGraphEdge[] = [];
  if (dem) {
    for (const e of dem.edges) {
      edges.push({ a: e.d1, b: e.d2, p: e.p, obs: e.obs, timelike: isTimelike(nodeByDetector.get(e.d1), nodeByDetector.get(e.d2)) });
    }
    for (const e of dem.boundary_edges) edges.push({ a: e.d, b: -1, p: e.p, obs: e.obs, timelike: false });
  }

  return { nodes: placed.nodes, boundary: placed.boundary, edges, hasCoordinates, aspect: placed.aspect };
}

interface PlacedNodes {
  nodes: DetectorNode[];
  boundary: { x: number; y: number };
  aspect: number;
}

function isTimelike(a?: DetectorNode, b?: DetectorNode): boolean {
  if (!a || !b) return false;
  return a.t !== b.t && a.sx !== undefined && a.sx === b.sx && a.sy === b.sy;
}

function circleNodes(n: number): PlacedNodes {
  const nodes = Array.from({ length: n }, (_, detector) => ({ detector, t: 0, ...circlePosition(detector, n) }));
  return { nodes, boundary: { x: 0.5, y: 0.97 }, aspect: 1 };
}

/**
 * Place detectors by (x, y), then shear each round along a fixed diagonal so
 * the rounds stay visibly apart instead of stacking on top of one another.
 * Everything is scaled by ONE factor into a unit box whose aspect is reported,
 * so the renderer never stretches x and y independently.
 */
function shearedNodes(coords: Array<[number, number, number]>): PlacedNodes {
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const ts = coords.map((c) => c[2]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const minT = Math.min(...ts);
  const spanT = Math.max(...ts) - minT;
  const spatial = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
  const shear = spanT > 0 ? (ROUND_SHEAR * spatial) / spanT : 0;

  const world = coords.map((c, detector) => ({
    detector,
    t: c[2],
    sx: c[0],
    sy: c[1],
    x: c[0] - minX + (c[2] - minT) * shear,
    y: c[1] - minY - (c[2] - minT) * shear,
  }));
  const yOffset = Math.max(0, ...world.map((w) => -w.y));
  const shifted = world.map((w) => ({ ...w, y: w.y + yOffset }));
  const width = Math.max(...shifted.map((w) => w.x), 1e-9);
  const graphHeight = Math.max(...shifted.map((w) => w.y), 1e-9);
  const boundaryY = graphHeight + BOUNDARY_GAP * spatial;
  const height = boundaryY + 0.04 * spatial;
  const margin = 0.04 * spatial;
  const boxW = width + 2 * margin;
  const boxH = height + margin;

  const nodes = shifted.map((w) => ({
    detector: w.detector, t: w.t, sx: w.sx, sy: w.sy,
    x: (w.x + margin) / boxW,
    y: (w.y + margin) / boxH,
  }));
  return {
    nodes,
    boundary: { x: 0.5, y: (boundaryY + margin) / boxH },
    aspect: boxW / boxH,
  };
}

/**
 * Map the unit box onto a canvas with ONE scale factor, centred, inside `pad`.
 * Returns the x / y mappers plus the drawn box size.
 */
export function fitGraphBox(
  aspect: number, cssW: number, cssH: number, pad: number,
): { X: (nx: number) => number; Y: (ny: number) => number; boxW: number; boxH: number } {
  const availW = Math.max(1, cssW - 2 * pad);
  const availH = Math.max(1, cssH - 2 * pad);
  const boxW = Math.min(availW, availH * aspect);
  const boxH = boxW / aspect;
  const left = (cssW - boxW) / 2;
  const top = (cssH - boxH) / 2;
  return { X: (nx) => left + nx * boxW, Y: (ny) => top + ny * boxH, boxW, boxH };
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

const STIM_MNEMONICS: Readonly<Record<string, string>> = {
  CNOT: 'CX', Measure: 'M', Reset: 'R', Hadamard: 'H', MEASURE: 'M', RESET: 'R',
};

/** The Stim mnemonic for a snapshot gate type (CNOT -> CX, Measure -> M, Reset -> R); unknown types stay as written, capped at 4 characters. */
export function timelineLabel(type: string): string {
  return STIM_MNEMONICS[type] ?? (type.length > 4 ? type.slice(0, 4) : type);
}

/** Qubits that carry at least one gate (noise included, detector/observable records excluded), ascending. */
export function activeTimelineQubits(gates: Gate[]): number[] {
  const used = new Set<number>();
  for (const g of gates) {
    if (g.type === 'DETECTOR' || g.type === 'OBSERVABLE') continue;
    for (const q of g.targets) used.add(q);
    for (const c of g.controls ?? []) used.add(c);
  }
  return [...used].sort((a, b) => a - b);
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
