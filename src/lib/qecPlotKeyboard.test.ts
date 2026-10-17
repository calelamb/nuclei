import { describe, it, expect } from 'vitest';
import { nextTargetIndex } from './qecPlotKeyboard';

const t = (seriesKey: string, x: number) => ({ seriesKey, x });
const targets = [t('a', 30), t('a', 10), t('a', 20), t('b', 12), t('b', 28)];

describe('nextTargetIndex', () => {
  it('starts on the first series, leftmost point', () => {
    expect(nextTargetIndex(targets, null, 'ArrowRight')).toBe(1);
  });
  it('walks along a series in x order and stops at the ends', () => {
    expect(nextTargetIndex(targets, 1, 'ArrowRight')).toBe(2);
    expect(nextTargetIndex(targets, 2, 'ArrowRight')).toBe(0);
    expect(nextTargetIndex(targets, 0, 'ArrowRight')).toBe(0);
    expect(nextTargetIndex(targets, 1, 'ArrowLeft')).toBe(1);
  });
  it('hops between series at the nearest x', () => {
    expect(nextTargetIndex(targets, 0, 'ArrowDown')).toBe(4);
    expect(nextTargetIndex(targets, 1, 'ArrowDown')).toBe(3);
    expect(nextTargetIndex(targets, 3, 'ArrowUp')).toBe(1);
    expect(nextTargetIndex(targets, 1, 'ArrowUp')).toBe(1);
  });
  it('jumps to series ends and ignores other keys', () => {
    expect(nextTargetIndex(targets, 2, 'Home')).toBe(1);
    expect(nextTargetIndex(targets, 2, 'End')).toBe(0);
    expect(nextTargetIndex(targets, 2, 'a')).toBe(2);
    expect(nextTargetIndex([], null, 'ArrowRight')).toBeNull();
  });
});
