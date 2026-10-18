import { describe, expect, it } from 'vitest';
import type { DiscoveryEvaluation } from '../../types/discovery';
import { describeMethod, formatAuditSeed } from './format';

describe('compute method labels (contract)', () => {
  it('knows every method the kernel emits, and passes unknown ones through', () => {
    expect(describeMethod('stim_pymatching_sampling')).toBe('Stim sampling with PyMatching');
    expect(describeMethod('pauli_propagation_bounded')).toBe('bounded Pauli propagation');
    expect(describeMethod('statevector_exact')).toBe('exact statevector');
    expect(describeMethod('some_new_method')).toBe('some new method');
  });

  it('the evaluation type accepts the widened methods', () => {
    const compute: NonNullable<DiscoveryEvaluation['compute']>[] = [
      { backend: 'stim', method: 'stim_pymatching_sampling' },
      { backend: 'numpy', method: 'pauli_propagation_bounded' },
      { backend: 'numpy', method: 'statevector_exact' },
      { backend: 'numpy', method: null },
    ];
    expect(compute).toHaveLength(4);
  });
});

describe('formatAuditSeed (display only)', () => {
  it('shows safe integers exactly and flags rounded 64-bit seeds', () => {
    expect(formatAuditSeed(12345)).toBe('12345');
    const big = JSON.parse('18446744073709551557') as number;
    expect(formatAuditSeed(big)).toMatch(/^≈ \d+ \(rounded; not exact\)$/);
    expect(formatAuditSeed(null)).toBe('—');
    expect(formatAuditSeed(Number.NaN)).toBe('—');
  });
});
