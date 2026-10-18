import { describe, it, expect } from 'vitest';
import {
  providerAllowsQsharp, submissionLanguage, providerStatus, providerNeedsToken, formatErrorRate,
} from './launchGating';

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

describe('providerStatus', () => {
  const base = { connected: false, isWeb: false, cudaqInstalled: false };

  it('marks the not-yet-built providers coming soon on every platform', () => {
    for (const provider of ['google', 'xanadu', 'dwave'] as const) {
      expect(providerStatus({ ...base, provider }).kind).toBe('coming-soon');
      expect(providerStatus({ ...base, provider, isWeb: true }).kind).toBe('coming-soon');
    }
  });

  it('badges every launchable provider desktop-only on the web build', () => {
    for (const provider of ['ibm', 'ionq', 'quantinuum', 'braket', 'azure', 'nvidia', 'simulator'] as const) {
      const status = providerStatus({ ...base, provider, isWeb: true, connected: true, cudaqInstalled: true });
      expect(status).toMatchObject({ kind: 'desktop-only', label: 'Desktop app' });
    }
  });

  it('needs a token for credentialed providers until the kernel confirms the connection', () => {
    expect(providerStatus({ ...base, provider: 'ibm' })).toMatchObject({ kind: 'needs-setup', label: 'Connect to enable' });
    expect(providerStatus({ ...base, provider: 'ibm', connected: true })).toMatchObject({ kind: 'ready', label: 'Connected' });
  });

  it('derives CUDA-Q readiness from the installed package, not a hard-coded flag', () => {
    expect(providerStatus({ ...base, provider: 'nvidia' })).toMatchObject({ kind: 'needs-setup', label: 'Install CUDA-Q' });
    expect(providerStatus({ ...base, provider: 'nvidia', cudaqInstalled: true })).toMatchObject({ kind: 'ready', label: 'Ready' });
  });

  it('treats the local simulator as ready on desktop', () => {
    expect(providerStatus({ ...base, provider: 'simulator' })).toMatchObject({ kind: 'ready', label: 'Ready' });
  });
});

describe('providerNeedsToken', () => {
  it('is true only for providers that take a token or key', () => {
    expect(providerNeedsToken('ibm')).toBe(true);
    expect(providerNeedsToken('braket')).toBe(true);
    expect(providerNeedsToken('simulator')).toBe(false);
    expect(providerNeedsToken('nvidia')).toBe(false);
  });
});

describe('formatErrorRate', () => {
  it('spells the error rate out instead of using a plus-minus sign', () => {
    expect(formatErrorRate(0.0032)).toBe('err 0.32%');
    expect(formatErrorRate(0)).toBe('Ideal');
  });
});
