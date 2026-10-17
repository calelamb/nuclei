import { describe, it, expect } from 'vitest';
import { arrowNavTarget } from './arrowNav';

describe('arrowNavTarget', () => {
  it('moves forward and wraps', () => {
    expect(arrowNavTarget('ArrowDown', 0, 3)).toBe(1);
    expect(arrowNavTarget('ArrowRight', 2, 3)).toBe(0);
  });
  it('moves back and wraps', () => {
    expect(arrowNavTarget('ArrowUp', 1, 3)).toBe(0);
    expect(arrowNavTarget('ArrowLeft', 0, 3)).toBe(2);
  });
  it('jumps with Home and End', () => {
    expect(arrowNavTarget('Home', 2, 4)).toBe(0);
    expect(arrowNavTarget('End', 0, 4)).toBe(3);
  });
  it('ignores other keys and empty lists', () => {
    expect(arrowNavTarget('a', 0, 3)).toBeNull();
    expect(arrowNavTarget('ArrowDown', 0, 0)).toBeNull();
  });
});
