import { describe, it, expect } from 'vitest';
import { qiskit2MigrationHint, QISKIT2_MIGRATIONS } from './errorRewriteQiskit2';

const CASES: Array<{ id: string; traceback: string; fixContains: string }> = [
  {
    id: 'primitives-v1',
    traceback:
      "Traceback (most recent call last):\n  File \"<nuclei>\", line 1, in <module>\nImportError: cannot import name 'Sampler' from 'qiskit.primitives'",
    fixContains: 'StatevectorSampler',
  },
  {
    id: 'primitives-v1',
    traceback: "ImportError: cannot import name 'Estimator' from 'qiskit.primitives' (/venv/qiskit/primitives/__init__.py)",
    fixContains: 'StatevectorEstimator',
  },
  {
    id: 'backend-primitives-v1',
    traceback: "ImportError: cannot import name 'BackendSampler' from 'qiskit.primitives'",
    fixContains: 'BackendSamplerV2',
  },
  {
    id: 'c-if',
    traceback: "AttributeError: 'InstructionSet' object has no attribute 'c_if'",
    fixContains: 'if_test',
  },
  {
    id: 'c-if',
    traceback: "AttributeError: 'XGate' object has no attribute 'c_if'",
    fixContains: 'if_test',
  },
  {
    id: 'bind-parameters',
    traceback: "AttributeError: 'QuantumCircuit' object has no attribute 'bind_parameters'",
    fixContains: 'assign_parameters',
  },
  {
    id: 'qasm',
    traceback: "AttributeError: 'QuantumCircuit' object has no attribute 'qasm'",
    fixContains: 'qasm2.dumps',
  },
  {
    id: 'execute',
    traceback: "ImportError: cannot import name 'execute' from 'qiskit' (/venv/qiskit/__init__.py)",
    fixContains: 'transpile',
  },
  {
    id: 'aer',
    traceback: "ImportError: cannot import name 'Aer' from 'qiskit'",
    fixContains: 'qiskit_aer',
  },
  {
    id: 'pulse',
    traceback: "ModuleNotFoundError: No module named 'qiskit.pulse'",
    fixContains: 'removed',
  },
  {
    id: 'fake-backends-v1',
    traceback: "ImportError: cannot import name 'FakeVigo' from 'qiskit.providers.fake_provider'",
    fixContains: 'qiskit_ibm_runtime.fake_provider',
  },
  {
    id: 'opflow',
    traceback: "ModuleNotFoundError: No module named 'qiskit.opflow'",
    fixContains: 'SparsePauliOp',
  },
  {
    id: 'algorithms',
    traceback: "ModuleNotFoundError: No module named 'qiskit.algorithms'",
    fixContains: 'qiskit_algorithms',
  },
  {
    id: 'quantum-instance',
    traceback: "ImportError: cannot import name 'QuantumInstance' from 'qiskit.utils'",
    fixContains: 'Sampler',
  },
];

describe('qiskit2MigrationHint', () => {
  it.each(CASES)('recognises $id', ({ id, traceback, fixContains }) => {
    const hint = qiskit2MigrationHint(traceback);
    expect(hint?.id).toBe(id);
    expect(hint?.explanation).toMatch(/Qiskit/);
    expect(hint?.fix).toContain(fixContains);
  });

  it('is null for unrelated errors', () => {
    expect(qiskit2MigrationHint('NameError: name "qc" is not defined')).toBeNull();
    expect(qiskit2MigrationHint("ImportError: cannot import name 'H' from 'cirq'")).toBeNull();
    expect(qiskit2MigrationHint("AttributeError: 'Circuit' object has no attribute 'c_if'")).toBeNull();
    expect(qiskit2MigrationHint('')).toBeNull();
  });

  it('does not mistake a missing module for the removed names', () => {
    // A name that merely contains "Sampler" is not the removed V1 class.
    expect(qiskit2MigrationHint("ImportError: cannot import name 'StatevectorSampler' from 'qiskit.primitives'")).toBeNull();
    expect(qiskit2MigrationHint("ImportError: cannot import name 'SamplerV2' from 'qiskit_aer.primitives'")).toBeNull();
  });

  it('has unique ids and a non-empty explanation and fix for every entry', () => {
    const ids = QISKIT2_MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of QISKIT2_MIGRATIONS) {
      expect(entry.explanation.length).toBeGreaterThan(20);
      expect(entry.fix.length).toBeGreaterThan(10);
    }
  });
});
