import { describe, expect, it } from 'vitest';
import { hashContent } from './hash';

describe('hashContent', () => {
  it('is deterministic for the same input', () => {
    const input = 'import qiskit\nqc = qiskit.QuantumCircuit(2)\n';
    expect(hashContent(input)).toBe(hashContent(input));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
    expect(hashContent('circuit v1')).not.toBe(hashContent('circuit v2'));
  });

  it('distinguishes empty string from other short strings', () => {
    expect(hashContent('')).not.toBe(hashContent('a'));
  });

  it('returns a hex string', () => {
    expect(hashContent('hello world')).toMatch(/^[0-9a-f]+$/);
  });
});
