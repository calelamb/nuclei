export interface BlochVector {
  x: number;
  y: number;
  z: number;
}

/** Below this length the reduced state is indistinguishable from maximally mixed. */
export const MIXED_EPSILON = 0.02;
/** Above this length the reduced state is pure (up to numerical noise). */
export const PURE_THRESHOLD = 0.98;

export function blochLength(v: BlochVector): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Purity Tr(rho^2) of a single-qubit state with Bloch vector length r: (1 + r^2) / 2. */
export function blochPurity(v: BlochVector): number {
  const r = blochLength(v);
  return (1 + r * r) / 2;
}

export type BlochStateKind = 'pure' | 'mixed' | 'maximally-mixed';

export interface BlochReadout {
  kind: BlochStateKind;
  length: number;
  purity: number;
  /** One-line, plain-language summary for the cell caption. */
  summary: string;
  /** Compact form for narrow cells. */
  short: string;
  /** Longer explanation for a tooltip / screen reader. */
  detail: string;
}

export function describeBlochState(v: BlochVector): BlochReadout {
  const length = blochLength(v);
  const purity = blochPurity(v);
  if (length < MIXED_EPSILON) {
    return {
      kind: 'maximally-mixed',
      length,
      purity,
      summary: 'Entangled · no single-qubit Bloch vector',
      short: 'Entangled',
      detail: 'This qubit is entangled with others, so it has no single-qubit Bloch vector. Its reduced state is maximally mixed: |r| = 0, purity 0.50.',
    };
  }
  if (length < PURE_THRESHOLD) {
    return {
      kind: 'mixed',
      length,
      purity,
      summary: `Mixed · |r| = ${length.toFixed(2)}`,
      short: `Mixed ${length.toFixed(2)}`,
      detail: `This qubit is partly entangled with others. The arrow shows its reduced state: |r| = ${length.toFixed(2)}, purity ${purity.toFixed(2)}.`,
    };
  }
  return {
    kind: 'pure',
    length,
    purity,
    summary: 'Pure state',
    short: 'Pure',
    detail: `This qubit is in a pure state (|r| = ${Math.min(1, length).toFixed(2)}).`,
  };
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Move between two Bloch vectors along the sphere: the direction slerps and the
 * length interpolates linearly, so a pure state sweeps an arc rather than
 * cutting through the ball. Falls back to a straight lerp when either end has no
 * direction (length ~ 0) or the ends are (anti)parallel.
 */
export function interpolateBloch(from: BlochVector, to: BlochVector, t: number): BlochVector {
  const lf = blochLength(from);
  const lt = blochLength(to);
  const linear = (): BlochVector => ({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), z: lerp(from.z, to.z, t) });
  if (lf < 1e-6 || lt < 1e-6) return linear();
  const a = { x: from.x / lf, y: from.y / lf, z: from.z / lf };
  const b = { x: to.x / lt, y: to.y / lt, z: to.z / lt };
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const sin = Math.sin(omega);
  if (sin < 1e-4) return linear();
  const wa = Math.sin((1 - t) * omega) / sin;
  const wb = Math.sin(t * omega) / sin;
  const len = lerp(lf, lt, t);
  return {
    x: (a.x * wa + b.x * wb) * len,
    y: (a.y * wa + b.y * wb) * len,
    z: (a.z * wa + b.z * wb) * len,
  };
}

export type BlochAudience = 'learn' | 'research';

/**
 * The caption under a sphere. Researchers read the numbers ("Mixed 0.39", "Pure"); learners get the
 * one idea that matters - this qubit is entangled - and nothing for a pure state (|r| stays in the tooltip).
 */
export function blochCaption(readout: BlochReadout, audience: BlochAudience, compact: boolean): string | null {
  if (audience === 'research') return compact ? readout.short : readout.summary;
  if (readout.kind === 'pure') return null;
  if (readout.kind === 'mixed') return 'Entangled';
  return compact ? readout.short : readout.summary;
}

/** Every qubit in |0>: the Bloch vectors a circuit has before it runs. */
export function groundStateCoords(qubitCount: number): BlochVector[] {
  return Array.from({ length: Math.max(0, Math.floor(qubitCount)) }, () => ({ x: 0, y: 0, z: 1 }));
}
