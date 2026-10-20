import { describe, expect, it } from 'vitest';
import { fitCircuitWidth } from './fitCircuit';

describe('fitCircuitWidth', () => {
  it('leaves a circuit that fits at natural size', () => {
    expect(fitCircuitWidth(240, 251)).toEqual({ scale: 1, scrolls: false });
  });
  it('scales a slight overflow to the column (the 288px Bell circuit in a 251px column)', () => {
    const fit = fitCircuitWidth(288, 251);
    expect(fit.scrolls).toBe(false);
    expect(fit.scale).toBeCloseTo(251 / 288, 5);
  });
  it('scrolls a much wider circuit instead of shrinking it to illegibility', () => {
    expect(fitCircuitWidth(900, 300)).toEqual({ scale: 1, scrolls: true });
  });
  it('ignores an unmeasured container', () => {
    expect(fitCircuitWidth(288, 0)).toEqual({ scale: 1, scrolls: false });
  });
});
