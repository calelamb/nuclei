import type { CircuitSnapshot, Gate } from '../../types/quantum';

// ---------------------------------------------------------------------------
// Conservative, pure classification of a parsed circuit as one of a small
// set of canonical teaching algorithms, plus the known-correct reference
// distribution for the ones whose outcome doesn't depend on an input state.
// Every check here is deliberately strict: a circuit is only ever labeled
// with 'high' confidence when its gate structure is an unambiguous match for
// the textbook construction. Anything else falls through to 'unknown' (or,
// for the one genuinely input-dependent case, 'low') rather than guessing.
// ---------------------------------------------------------------------------

export type AlgorithmKind = 'bell' | 'ghz' | 'uniform_superposition' | 'teleportation' | 'unknown';

export interface AlgorithmClassification {
  algorithm: AlgorithmKind;
  confidence: 'high' | 'low';
}

const MEASUREMENT_TYPE_RE = /^(measure|m|mz|mresetz)$/i;
const CNOT_TYPE_RE = /^(cnot|cx)$/i;

function isSingleQubitH(gate: Gate): boolean {
  return gate.type.toUpperCase() === 'H' && gate.controls.length === 0 && gate.targets.length === 1;
}

function isCnot(gate: Gate): boolean {
  return CNOT_TYPE_RE.test(gate.type) && gate.controls.length === 1 && gate.targets.length === 1;
}

function coreGates(snapshot: CircuitSnapshot): Gate[] {
  return snapshot.gates.filter((g) => !MEASUREMENT_TYPE_RE.test(g.type));
}

/** Bell: exactly 2 qubits, exactly one H followed by exactly one CNOT/CX
 * whose control is the qubit H acted on and whose target is the other
 * qubit. Any other core gate present disqualifies the match. */
function classifyBell(snapshot: CircuitSnapshot): boolean {
  if (snapshot.qubit_count !== 2) return false;
  const core = coreGates(snapshot);
  if (core.length !== 2) return false;

  const [h, cx] = core;
  if (!isSingleQubitH(h) || !isCnot(cx)) return false;

  const hQubit = h.targets[0];
  const [control] = cx.controls;
  const [target] = cx.targets;
  return control === hQubit && target !== hQubit;
}

/** GHZ: n >= 3 qubits, exactly one H followed by exactly n-1 CNOT/CX gates
 * that entangle every remaining qubit into the set the H qubit started —
 * accepts both the chain (0->1->2->...) and star (0->1, 0->2, ...) forms,
 * rejecting anything that doesn't fully connect all n qubits. */
function classifyGhz(snapshot: CircuitSnapshot): boolean {
  const n = snapshot.qubit_count;
  if (n < 3) return false;

  const core = coreGates(snapshot);
  if (core.length !== n) return false;

  const [first, ...rest] = core;
  if (!isSingleQubitH(first)) return false;
  if (!rest.every(isCnot)) return false;

  const entangled = new Set<number>([first.targets[0]]);
  for (const gate of rest) {
    const [control] = gate.controls;
    const [target] = gate.targets;
    if (!entangled.has(control) || entangled.has(target)) return false;
    entangled.add(target);
  }

  return entangled.size === n;
}

/** Uniform superposition: n qubits, exactly one H per qubit (every qubit
 * targeted exactly once), and no entangling (2+ qubit) gates at all. */
function classifyUniformSuperposition(snapshot: CircuitSnapshot): boolean {
  const n = snapshot.qubit_count;
  if (n < 1) return false;

  const core = coreGates(snapshot);
  if (core.length !== n) return false;
  if (!core.every(isSingleQubitH)) return false;

  const targeted = new Set(core.map((g) => g.targets[0]));
  if (targeted.size !== n) return false;
  for (let q = 0; q < n; q += 1) {
    if (!targeted.has(q)) return false;
  }
  return true;
}

/** Conservative teleportation heuristic: 3 qubits, at least 2 classical
 * bits, at least 2 H gates, at least 2 CNOT/CX gates, and at least 2
 * distinct qubits measured. This is deliberately loose on gate ordering and
 * on how the classically-controlled corrections are expressed (real
 * mid-circuit conditional gates vs. a simulator-friendly CCX substitute),
 * because there is no single canonical teleportation circuit the way there
 * is for Bell/GHZ/uniform superposition. Confidence is therefore capped at
 * 'low' — this never claims 'high' for teleportation. */
function looksLikeTeleportation(snapshot: CircuitSnapshot): boolean {
  if (snapshot.qubit_count !== 3 || snapshot.classical_bit_count < 2) return false;

  const core = coreGates(snapshot);
  const hCount = core.filter(isSingleQubitH).length;
  const cnotCount = core.filter(isCnot).length;

  const measuredQubits = new Set<number>();
  for (const gate of snapshot.gates) {
    if (MEASUREMENT_TYPE_RE.test(gate.type)) {
      for (const q of gate.targets) measuredQubits.add(q);
    }
  }

  return hCount >= 2 && cnotCount >= 2 && measuredQubits.size >= 2;
}

/** Classifies a parsed circuit as one of the recognized canonical teaching
 * algorithms. Pure and conservative: 'high' confidence is only ever
 * returned for an unambiguous structural match; everything else is 'low'
 * (including a plausible-but-unverifiable teleportation guess) so callers
 * never treat a shaky guess as a verified fact. */
export function classifyAlgorithm(snapshot: CircuitSnapshot): AlgorithmClassification {
  if (classifyBell(snapshot)) return { algorithm: 'bell', confidence: 'high' };
  if (classifyGhz(snapshot)) return { algorithm: 'ghz', confidence: 'high' };
  if (classifyUniformSuperposition(snapshot)) return { algorithm: 'uniform_superposition', confidence: 'high' };
  if (looksLikeTeleportation(snapshot)) return { algorithm: 'teleportation', confidence: 'low' };
  return { algorithm: 'unknown', confidence: 'low' };
}

/** Above this many qubits, a uniform-superposition reference distribution
 * would need 2^n entries — capped to avoid building huge maps for a
 * classification that Dirac wouldn't usefully iterate over anyway. */
const UNIFORM_SUPERPOSITION_QUBIT_CAP = 10;

/**
 * Known-correct reference distribution for a classified algorithm, or null
 * when the outcome legitimately depends on the input state (teleportation)
 * or the circuit wasn't recognized as one of the fixed-outcome algorithms.
 *
 * Bitstring keys follow the same convention the kernel adapters use to key
 * `SimulationResult.probabilities`: `format(i, f"0{qubitCount}b")` — the
 * zero-padded binary form of the state-vector index, with qubit 0 as the
 * leftmost (most-significant) character. Verified against
 * kernel/adapters/qiskit_adapter.py:112-116, kernel/adapters/cirq_adapter.py:133-137,
 * and the explicit big-endian note in kernel/adapters/qsharp_adapter.py:700-702.
 * Bell/GHZ/uniform-superposition distributions happen to be symmetric under
 * bit order either way, so this convention choice doesn't change the maps
 * below — it's documented for callers building distributions for other
 * algorithms in the future.
 */
export function expectedDistribution(algorithm: AlgorithmKind, qubitCount: number): Record<string, number> | null {
  switch (algorithm) {
    case 'bell':
      return qubitCount === 2 ? { '00': 0.5, '11': 0.5 } : null;

    case 'ghz': {
      if (qubitCount < 3) return null;
      const zeros = '0'.repeat(qubitCount);
      const ones = '1'.repeat(qubitCount);
      return { [zeros]: 0.5, [ones]: 0.5 };
    }

    case 'uniform_superposition': {
      if (qubitCount < 1 || qubitCount > UNIFORM_SUPERPOSITION_QUBIT_CAP) return null;
      const total = 2 ** qubitCount;
      const probability = 1 / total;
      const distribution: Record<string, number> = {};
      for (let i = 0; i < total; i += 1) {
        distribution[i.toString(2).padStart(qubitCount, '0')] = probability;
      }
      return distribution;
    }

    case 'teleportation':
    case 'unknown':
    default:
      return null;
  }
}
