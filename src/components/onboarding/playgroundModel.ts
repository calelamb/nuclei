export type Outcome = 0 | 1;
export type QubitKind = 'zero' | 'superposition' | 'measured';
export type PlaygroundAction = 'apply_h' | 'measure' | 'measure_many' | 'entangle' | 'bridge' | null;

export const MANY_SHOTS = 10;

export interface PairResult {
  /** Joint shots on the entangled pair: only |00> and |11> can ever appear. */
  counts: { '00': number; '11': number };
  /** The outcome both qubits showed on the most recent shot. */
  last: Outcome;
}

export interface PlaygroundState {
  step: number;
  qubit: QubitKind;
  /** What the last single-qubit measurement gave; the Bloch arrow follows it. */
  lastOutcome: Outcome | null;
  /** The shots behind the single-qubit histogram (replaced, never accumulated, so counts add up). */
  shots: Outcome[];
  pair: PairResult | null;
  bridging: boolean;
}

export function initialState(): PlaygroundState {
  return { step: 0, qubit: 'zero', lastOutcome: null, shots: [], pair: null, bridging: false };
}

const sample = (rng: () => number): Outcome => (rng() > 0.5 ? 1 : 0);

/** Pure step transition; `rng` is injected so tests (and reduced-motion) are deterministic. */
export function advance(state: PlaygroundState, action: PlaygroundAction, rng: () => number): PlaygroundState {
  const next = { ...state, step: state.step + 1 };
  switch (action) {
    case 'apply_h':
      return { ...next, qubit: 'superposition' };
    case 'measure': {
      const outcome = sample(rng);
      return { ...next, qubit: 'measured', lastOutcome: outcome, shots: [outcome] };
    }
    case 'measure_many': {
      const shots = Array.from({ length: MANY_SHOTS }, () => sample(rng));
      return { ...next, qubit: 'measured', lastOutcome: shots[shots.length - 1], shots };
    }
    case 'entangle': {
      const joint = Array.from({ length: MANY_SHOTS }, () => sample(rng));
      const ones = joint.filter((o) => o === 1).length;
      const last = joint[joint.length - 1];
      return {
        ...next,
        qubit: 'measured',
        lastOutcome: last,
        pair: { counts: { '00': MANY_SHOTS - ones, '11': ones }, last },
      };
    }
    case 'bridge':
      return { ...state, bridging: true };
    default:
      return next;
  }
}

export function tally(shots: readonly Outcome[]): { zeros: number; ones: number; total: number } {
  const ones = shots.filter((o) => o === 1).length;
  return { zeros: shots.length - ones, ones, total: shots.length };
}

/** Arrow angle in degrees on the playground's vertical axis: -90 is |0> (up), +90 is |1> (down), 0 is the equator. */
export function arrowAngle(kind: QubitKind, outcome: Outcome | null): number {
  if (kind === 'superposition') return 0;
  if (kind === 'measured') return outcome === 1 ? 90 : -90;
  return -90;
}
