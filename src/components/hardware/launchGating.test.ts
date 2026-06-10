import { describe, it, expect } from 'vitest';
import { providerAllowsQsharp, submissionLanguage } from './launchGating';

describe('providerAllowsQsharp', () => {
  it('allows Azure Quantum and the Local Simulator', () => {
    expect(providerAllowsQsharp('azure')).toBe(true);
    expect(providerAllowsQsharp('simulator')).toBe(true);
  });

  it('rejects every other provider', () => {
    for (const provider of ['ibm', 'ionq', 'quantinuum', 'braket', 'nvidia', 'google', 'xanadu', 'dwave']) {
      expect(providerAllowsQsharp(provider)).toBe(false);
    }
  });
});

describe('submissionLanguage', () => {
  it('derives qsharp from a staged .qs file regardless of editor framework', () => {
    expect(submissionLanguage('bell.qs', 'qiskit')).toBe('qsharp');
    expect(submissionLanguage('BELL.QS', 'cirq')).toBe('qsharp');
  });

  it('treats staged non-.qs files as python even when the editor holds Q#', () => {
    expect(submissionLanguage('bell.py', 'qsharp')).toBe('python');
    expect(submissionLanguage('circuit.qasm', 'qsharp')).toBe('python');
  });

  it('falls back to the editor framework when nothing is staged', () => {
    expect(submissionLanguage(null, 'qsharp')).toBe('qsharp');
    expect(submissionLanguage(null, 'qiskit')).toBe('python');
    expect(submissionLanguage(null, 'cirq')).toBe('python');
    expect(submissionLanguage(null, 'cuda-q')).toBe('python');
  });
});
