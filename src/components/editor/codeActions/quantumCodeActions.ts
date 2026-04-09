/**
 * Quantum Code Actions — lightbulb suggestions in the editor gutter.
 *
 * Detects optimization opportunities, missing measurements, redundant gates,
 * and offers one-click fixes. Registered as a Monaco CodeActionProvider.
 */

import { useCircuitStore } from '../../../stores/circuitStore';
import type { CircuitSnapshot } from '../../../types/quantum';

export interface CodeAction {
  title: string;
  kind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edit: { range: any; text: string } | null;
  // For API-based actions (framework conversion, complex optimization)
  requiresApi?: boolean;
  prompt?: string;
}

function detectRedundantGates(snapshot: CircuitSnapshot): CodeAction[] {
  const actions: CodeAction[] = [];
  const gates = snapshot.gates;

  // Find adjacent identical gates that cancel (H·H, X·X, Y·Y, Z·Z)
  const selfInverse = new Set(['H', 'X', 'Y', 'Z']);
  for (let i = 0; i < gates.length - 1; i++) {
    const g1 = gates[i];
    const g2 = gates[i + 1];
    if (
      selfInverse.has(g1.type) &&
      g1.type === g2.type &&
      g1.targets[0] === g2.targets[0] &&
      g1.controls.length === 0 &&
      g2.controls.length === 0 &&
      g2.layer === g1.layer + 1
    ) {
      actions.push({
        title: `Remove redundant ${g1.type}·${g2.type} pair (cancels to identity)`,
        kind: 'quickfix.optimize',
        edit: null, // Requires API to modify code
        requiresApi: true,
        prompt: `Remove the redundant pair of ${g1.type} gates on qubit ${g1.targets[0]} (they cancel out to identity). Only return the modified code.`,
      });
    }
  }

  return actions;
}

function detectMissingMeasurements(snapshot: CircuitSnapshot): CodeAction[] {
  const hasMeasure = snapshot.gates.some((g) => g.type === 'Measure');
  if (hasMeasure || snapshot.qubit_count === 0) return [];

  return [{
    title: 'Add measurements to all qubits',
    kind: 'quickfix.measurement',
    edit: null,
    requiresApi: true,
    prompt: `Add measurement gates to all ${snapshot.qubit_count} qubits at the end of the circuit. Also add the corresponding classical bits if needed. Only return the modified code.`,
  }];
}

function detectParameterization(snapshot: CircuitSnapshot): CodeAction[] {
  const rotations = snapshot.gates.filter((g) => ['RX', 'RY', 'RZ'].includes(g.type) && g.params.length > 0);
  if (rotations.length < 2) return [];

  return [{
    title: 'Parameterize rotation angles',
    kind: 'refactor.parameterize',
    edit: null,
    requiresApi: true,
    prompt: 'Extract hardcoded rotation angles into named variables/parameters. Only return the modified code.',
  }];
}

function detectFrameworkConversion(snapshot: CircuitSnapshot): CodeAction[] {
  const frameworks = ['qiskit', 'cirq', 'cuda-q'].filter((f) => f !== snapshot.framework);
  return frameworks.map((target) => ({
    title: `Convert to ${target === 'cuda-q' ? 'CUDA-Q' : target.charAt(0).toUpperCase() + target.slice(1)}`,
    kind: 'refactor.convert',
    edit: null,
    requiresApi: true,
    prompt: `Convert this ${snapshot.framework} circuit to ${target}. Produce equivalent code in ${target}. Only return the converted code.`,
  }));
}

export function analyzeCircuit(): CodeAction[] {
  const snapshot = useCircuitStore.getState().snapshot;
  if (!snapshot || snapshot.gates.length === 0) return [];

  return [
    ...detectRedundantGates(snapshot),
    ...detectMissingMeasurements(snapshot),
    ...detectParameterization(snapshot),
    ...detectFrameworkConversion(snapshot),
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerCodeActionProvider(monaco: any) {
  return monaco.languages.registerCodeActionProvider('python', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideCodeActions(_model: any) {
      const actions = analyzeCircuit();
      if (actions.length === 0) return { actions: [], dispose() {} };

      return {
        actions: actions.map((action) => ({
          title: action.title,
          kind: action.kind,
          isPreferred: action.kind.startsWith('quickfix'),
          diagnostics: [],
          edit: action.edit ? { edits: [{ resource: _model.uri, textEdit: action.edit }] } : undefined,
          command: action.requiresApi ? {
            id: 'nuclei.codeAction',
            title: action.title,
            arguments: [action.prompt],
          } : undefined,
        })),
        dispose() {},
      };
    },
  });
}
