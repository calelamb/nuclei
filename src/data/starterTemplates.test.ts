import { describe, it, expect } from 'vitest';
import {
  STARTER_TEMPLATES,
  displayFrameworkName,
  defaultCircuitFileName,
} from './starterTemplates';

describe('starterTemplates — Q#', () => {
  it('qsharp starter is a runnable Bell-state Main operation', () => {
    expect(STARTER_TEMPLATES.qsharp).toContain('operation Main');
    expect(STARTER_TEMPLATES.qsharp).toContain('DumpMachine');
    expect(STARTER_TEMPLATES.qsharp).toContain('CNOT(qs[0], qs[1])');
    expect(STARTER_TEMPLATES.qsharp).toContain('ResetAll(qs)');
  });

  it('displays Q# with its QDK branding', () => {
    expect(displayFrameworkName('qsharp')).toBe('Q# (QDK)');
  });

  it('defaults the Q# circuit file to a .qs extension', () => {
    expect(defaultCircuitFileName('qsharp')).toBe('qsharp_circuit.qs');
  });

  it('keeps Python frameworks on .py filenames', () => {
    expect(defaultCircuitFileName('qiskit')).toBe('qiskit_circuit.py');
    expect(defaultCircuitFileName('cirq')).toBe('cirq_circuit.py');
    expect(defaultCircuitFileName('cuda-q')).toBe('cudaq_circuit.py');
  });
});
