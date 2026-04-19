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
};

export function displayFrameworkName(f: Framework): string {
  return f === 'cuda-q' ? 'CUDA-Q' : f.charAt(0).toUpperCase() + f.slice(1);
}

/**
 * Default filename for a new circuit in the given framework. PyCharm-style:
 * lowercase, dotted to namespace the framework so students can tell them
 * apart in the tree at a glance.
 */
export function defaultCircuitFileName(f: Framework): string {
  const slug = f === 'cuda-q' ? 'cudaq' : f;
  return `${slug}_circuit.py`;
}
