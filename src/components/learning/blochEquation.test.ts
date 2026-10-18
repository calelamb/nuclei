import { describe, expect, it } from 'vitest';
import { formatStateEquation } from './blochEquation';

describe('formatStateEquation', () => {
  it('writes |0> and |1> exactly', () => {
    expect(formatStateEquation(0, 0)).toBe('1|0⟩ + 0|1⟩');
    expect(formatStateEquation(Math.PI, 0)).toBe('0|0⟩ + 1|1⟩');
  });

  it('writes |+> and |-> with a proper sign, never "+ -"', () => {
    expect(formatStateEquation(Math.PI / 2, 0)).toBe('0.707|0⟩ + 0.707|1⟩');
    const minus = formatStateEquation(Math.PI / 2, Math.PI);
    expect(minus).toBe('0.707|0⟩ − 0.707|1⟩');
    expect(minus).not.toContain('+ -');
  });

  it('writes the imaginary states', () => {
    expect(formatStateEquation(Math.PI / 2, Math.PI / 2)).toBe('0.707|0⟩ + 0.707i|1⟩');
    expect(formatStateEquation(Math.PI / 2, (3 * Math.PI) / 2)).toBe('0.707|0⟩ − 0.707i|1⟩');
  });

  it('parenthesises a genuinely complex amplitude', () => {
    expect(formatStateEquation(Math.PI / 2, Math.PI / 4)).toBe('0.707|0⟩ + (0.500 + 0.500i)|1⟩');
    expect(formatStateEquation(Math.PI / 2, (5 * Math.PI) / 4)).toBe('0.707|0⟩ + (−0.500 − 0.500i)|1⟩');
  });
});
