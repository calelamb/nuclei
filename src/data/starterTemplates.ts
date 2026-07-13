import type { Framework } from '../types/quantum';

/**
 * Starter Bell-state circuit for each supported framework. Shared between
 * the framework selector (to reset the buffer when the user explicitly
 * switches framework) and the FileExplorer "new circuit" menu (so the
 * quickstart file has runnable code, not an empty page).
 */
export const STARTER_TEMPLATES: Record<Framework, string> = {
  qiskit: `from qiskit import QuantumCircuit

# Create a Bell State
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
`,
  cirq: `import cirq

# Create a Bell State
q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.CNOT(q0, q1),
    cirq.measure(q0, q1, key='result'),
])
`,
  'cuda-q': `import cudaq

# Create a Bell State
@cudaq.kernel
def bell():
    q = cudaq.qvector(2)
    h(q[0])
    cx(q[0], q[1])
    mz(q)
`,
  qsharp: `import Std.Diagnostics.DumpMachine;

// Create a Bell State
operation Main() : Result[] {
    use qs = Qubit[2];
    H(qs[0]);
    CNOT(qs[0], qs[1]);
    DumpMachine();        // shows the live quantum state in Nuclei's panels
    let results = [M(qs[0]), M(qs[1])];
    ResetAll(qs);
    return results;
}
`,
  stim: `import stim

# Distance-3 repetition code memory experiment (3 rounds).
# Swap in surface_code:rotated_memory_z to go 2D.
circuit = stim.Circuit.generated(
    "repetition_code:memory",
    distance=3,
    rounds=3,
    after_clifford_depolarization=0.001,
    before_measure_flip_probability=0.001,
)
`,
};

export function displayFrameworkName(f: Framework): string {
  if (f === 'cuda-q') return 'CUDA-Q';
  if (f === 'qsharp') return 'Q# (QDK)';
  if (f === 'stim') return 'Stim';
  return f.charAt(0).toUpperCase() + f.slice(1);
}

/**
 * Default filename for a new circuit in the given framework. PyCharm-style:
 * lowercase, dotted to namespace the framework so students can tell them
 * apart in the tree at a glance.
 */
export function defaultCircuitFileName(f: Framework): string {
  if (f === 'qsharp') return 'qsharp_circuit.qs';
  const slug = f === 'cuda-q' ? 'cudaq' : f;
  return `${slug}_circuit.py`;
}
