import { describe, expect, it } from 'vitest';
import { chooseChipLayout, entryWidth } from './chipLayout';

describe('chooseChipLayout', () => {
  it('keeps the single line when three short outcomes fit', () => {
    expect(chooseChipLayout(['00', '01', '11'], 560, false)).toBe('inline');
  });

  it('stacks rows when a 3-qubit chip in a ~340px rail cannot fit ket, bar and percentage side by side', () => {
    expect(chooseChipLayout(['000', '001', '111'], 340, false)).toBe('rows');
  });

  it('stacks rows for 6-qubit bitstrings in a 1440px rail (the clipped |01000⟩ case)', () => {
    expect(chooseChipLayout(['010000', '010001', '011000'], 400, false)).toBe('rows');
  });

  it('needs more room when hardware percentages are shown', () => {
    expect(entryWidth('00', true)).toBeGreaterThan(entryWidth('00', false));
  });

  it('keeps inline when unmeasured so first paint and tests are stable', () => {
    expect(chooseChipLayout(['000000', '000001', '000010'], 0, false)).toBe('inline');
  });
});
