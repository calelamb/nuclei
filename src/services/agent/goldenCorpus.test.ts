import { describe, expect, it } from 'vitest';
import type { CircuitSnapshot, Gate, SimulationResult } from '../../types/quantum';
import { classifyAlgorithm, expectedDistribution } from './algorithms';
import { execCheckAlgorithmInvariant } from './algorithmInvariantExecutor';
import { defaultFrameworkResolver } from './toolContext';
import type { ToolContext } from './toolContext';
import { InMemoryWorkspace } from './workspace';

// ---------------------------------------------------------------------------
// Golden corpus: hand-built CircuitSnapshots for the canonical algorithms
// classifyAlgorithm/expectedDistribution recognize, plus at least one
// intentionally broken variant. Verifies the classifier only ever claims
// 'high' confidence for a genuine structural match, that the reference
// distributions are correct, and that check_algorithm_invariant's
// executor wires the two together correctly end to end.
// ---------------------------------------------------------------------------

function gate(overrides: Partial<Gate> & Pick<Gate, 'type'>): Gate {
  return { targets: [], controls: [], params: [], layer: 0, ...overrides };
}

function simResult(probabilities: Record<string, number>): SimulationResult {
  return {
    state_vector: [],
    probabilities,
    measurements: {},
    bloch_coords: [],
    execution_time_ms: 1,
    shot_count: 1024,
  };
}

/** Minimal ToolContext for exercising execCheckAlgorithmInvariant directly,
 * without going through the model/orchestrator loop. */
function makeCtx(snapshot?: CircuitSnapshot, sim?: SimulationResult): ToolContext {
  const workspace = new InMemoryWorkspace([
    { path: 'main.py', framework: 'qiskit', content: '# n/a', dirty: false },
  ]);
  return {
    workspace,
    kernel: {
      parse: async () => ({ ok: true, snapshot: snapshot ?? { framework: 'qiskit', qubit_count: 0, classical_bit_count: 0, depth: 0, gates: [] } }),
      simulate: async () => ({ ok: true, result: sim ?? simResult({}) }),
    },
    lastSim: { result: sim },
    lastSnapshot: { snapshot },
    resolveFramework: defaultFrameworkResolver(workspace),
    lastKnownHash: new Map(),
  };
}

const CORRECT_BELL: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 2,
  classical_bit_count: 2,
  depth: 3,
  gates: [
    gate({ type: 'H', targets: [0], layer: 0 }),
    gate({ type: 'CNOT', targets: [1], controls: [0], layer: 1 }),
    gate({ type: 'measure', targets: [0], layer: 2 }),
    gate({ type: 'measure', targets: [1], layer: 2 }),
  ],
};

const CORRECT_GHZ_3: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 3,
  classical_bit_count: 3,
  depth: 4,
  gates: [
    gate({ type: 'H', targets: [0], layer: 0 }),
    gate({ type: 'CNOT', targets: [1], controls: [0], layer: 1 }),
    gate({ type: 'CNOT', targets: [2], controls: [1], layer: 2 }),
    gate({ type: 'measure', targets: [0, 1, 2], layer: 3 }),
  ],
};

const CORRECT_UNIFORM_2: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 2,
  classical_bit_count: 2,
  depth: 2,
  gates: [
    gate({ type: 'H', targets: [0], layer: 0 }),
    gate({ type: 'H', targets: [1], layer: 0 }),
    gate({ type: 'measure', targets: [0, 1], layer: 1 }),
  ],
};

/** Intentionally broken: a "Bell" circuit missing the entangling CNOT — the
 * H-only fragment leaves the qubits in a product state, not an entangled
 * Bell pair. Must NOT be misclassified as bell. */
const BROKEN_BELL_MISSING_CNOT: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 2,
  classical_bit_count: 2,
  depth: 2,
  gates: [
    gate({ type: 'H', targets: [0], layer: 0 }),
    gate({ type: 'measure', targets: [0], layer: 1 }),
    gate({ type: 'measure', targets: [1], layer: 1 }),
  ],
};

/** Intentionally broken: a "GHZ" chain that never touches qubit 2 — the
 * second CNOT re-targets qubit 1 instead of extending the chain, so the
 * circuit never entangles all 3 qubits. Must NOT be misclassified as GHZ. */
const BROKEN_GHZ_DISCONNECTED: CircuitSnapshot = {
  framework: 'qiskit',
  qubit_count: 3,
  classical_bit_count: 3,
  depth: 3,
  gates: [
    gate({ type: 'H', targets: [0], layer: 0 }),
    gate({ type: 'CNOT', targets: [1], controls: [0], layer: 1 }),
    gate({ type: 'CNOT', targets: [1], controls: [0], layer: 2 }),
  ],
};

describe('golden corpus — classifyAlgorithm', () => {
  it('classifies a correct Bell circuit as bell with high confidence', () => {
    expect(classifyAlgorithm(CORRECT_BELL)).toEqual({ algorithm: 'bell', confidence: 'high' });
  });

  it('classifies a correct 3-qubit GHZ circuit as ghz with high confidence', () => {
    expect(classifyAlgorithm(CORRECT_GHZ_3)).toEqual({ algorithm: 'ghz', confidence: 'high' });
  });

  it('classifies a correct 2-qubit uniform superposition with high confidence', () => {
    expect(classifyAlgorithm(CORRECT_UNIFORM_2)).toEqual({
      algorithm: 'uniform_superposition',
      confidence: 'high',
    });
  });

  it('does not misclassify a Bell circuit missing its CNOT as bell', () => {
    const result = classifyAlgorithm(BROKEN_BELL_MISSING_CNOT);
    expect(result.algorithm).not.toBe('bell');
    expect(result).toEqual({ algorithm: 'unknown', confidence: 'low' });
  });

  it('does not misclassify a disconnected GHZ attempt as ghz', () => {
    const result = classifyAlgorithm(BROKEN_GHZ_DISCONNECTED);
    expect(result.algorithm).not.toBe('ghz');
    expect(result).toEqual({ algorithm: 'unknown', confidence: 'low' });
  });

  it('never returns high confidence for teleportation', () => {
    const teleport: CircuitSnapshot = {
      framework: 'qiskit',
      qubit_count: 3,
      classical_bit_count: 3,
      depth: 6,
      gates: [
        gate({ type: 'H', targets: [1], layer: 0 }),
        gate({ type: 'CNOT', targets: [2], controls: [1], layer: 1 }),
        gate({ type: 'CNOT', targets: [1], controls: [0], layer: 2 }),
        gate({ type: 'H', targets: [0], layer: 3 }),
        gate({ type: 'measure', targets: [0, 1], layer: 4 }),
        gate({ type: 'CCX', targets: [2], controls: [0, 1], layer: 5 }),
      ],
    };
    const result = classifyAlgorithm(teleport);
    expect(result.confidence).not.toBe('high');
  });
});

describe('golden corpus — expectedDistribution', () => {
  it('matches the Bell reference distribution', () => {
    expect(expectedDistribution('bell', 2)).toEqual({ '00': 0.5, '11': 0.5 });
  });

  it('matches the 3-qubit GHZ reference distribution', () => {
    expect(expectedDistribution('ghz', 3)).toEqual({ '000': 0.5, '111': 0.5 });
  });

  it('matches the 2-qubit uniform superposition reference distribution', () => {
    expect(expectedDistribution('uniform_superposition', 2)).toEqual({
      '00': 0.25,
      '01': 0.25,
      '10': 0.25,
      '11': 0.25,
    });
  });

  it('returns null for teleportation — outcome depends on the input state', () => {
    expect(expectedDistribution('teleportation', 3)).toBeNull();
  });

  it('returns null for unknown', () => {
    expect(expectedDistribution('unknown', 2)).toBeNull();
  });
});

describe('golden corpus — check_algorithm_invariant executor', () => {
  it('matches:true for a correct Bell simulation', () => {
    const ctx = makeCtx(CORRECT_BELL, simResult({ '00': 0.5, '11': 0.5 }));
    const evidence = execCheckAlgorithmInvariant({}, 'tc1', ctx);
    expect(evidence.ok).toBe(true);
    expect(evidence.facts).toMatchObject({ checked: true, algorithm: 'bell', matches: true });
  });

  it('matches:false for a wrong Bell simulation', () => {
    const ctx = makeCtx(CORRECT_BELL, simResult({ '00': 1.0 }));
    const evidence = execCheckAlgorithmInvariant({}, 'tc1', ctx);
    expect(evidence.ok).toBe(true);
    expect(evidence.facts).toMatchObject({ checked: true, algorithm: 'bell', matches: false });
  });

  it('matches:true for a correct GHZ simulation', () => {
    const ctx = makeCtx(CORRECT_GHZ_3, simResult({ '000': 0.5, '111': 0.5 }));
    const evidence = execCheckAlgorithmInvariant({}, 'tc1', ctx);
    expect(evidence.facts).toMatchObject({ checked: true, algorithm: 'ghz', matches: true });
  });

  it('matches:true for a correct uniform superposition simulation', () => {
    const ctx = makeCtx(CORRECT_UNIFORM_2, simResult({ '00': 0.25, '01': 0.25, '10': 0.25, '11': 0.25 }));
    const evidence = execCheckAlgorithmInvariant({}, 'tc1', ctx);
    expect(evidence.facts).toMatchObject({ checked: true, algorithm: 'uniform_superposition', matches: true });
  });

  it('the broken Bell variant is never reported as a matching bell invariant', () => {
    // Even feeding it the textbook-correct Bell probabilities, the broken
    // circuit classifies as unknown, so there is no fixed reference to
    // check against — it must never be reported as a verified match.
    const ctx = makeCtx(BROKEN_BELL_MISSING_CNOT, simResult({ '00': 0.5, '11': 0.5 }));
    const evidence = execCheckAlgorithmInvariant({}, 'tc1', ctx);
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.checked).toBe(false);
    expect(evidence.facts.algorithm).toBe('unknown');
  });

  it('reports checked:false with no simulation available', () => {
    const ctx = makeCtx(CORRECT_BELL, undefined);
    const evidence = execCheckAlgorithmInvariant({}, 'tc1', ctx);
    expect(evidence.ok).toBe(true);
    expect(evidence.facts.checked).toBe(false);
  });
});
