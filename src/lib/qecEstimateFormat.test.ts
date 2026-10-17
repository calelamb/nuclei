import { describe, expect, it } from 'vitest';
import { humanNs } from './qecEstimateFormat';

describe('humanNs', () => {
  it('walks ns, µs, ms, s, min, h, d', () => {
    expect(humanNs(500)).toBe('500 ns');
    expect(humanNs(28_000)).toBe('28.00 µs');
    expect(humanNs(3.2e6)).toBe('3.20 ms');
    expect(humanNs(4.5e9)).toBe('4.50 s');
    expect(humanNs(1.2e11)).toBe('2.00 min');
  });
  it('does not stop at minutes (qec-r-23)', () => {
    expect(humanNs(7.2e12)).toBe('2.00 h');
    expect(humanNs(2 * 8.64e13)).toBe('2.00 d');
    expect(humanNs(3.6e13)).toBe('10.00 h');
  });
  it('shows a dash for missing values', () => {
    expect(humanNs(null)).toBe('—');
    expect(humanNs(Number.NaN)).toBe('—');
  });
});
