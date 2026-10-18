import { describe, it, expect } from 'vitest';
import { canvasGrid, isInstrumentEmpty } from './canvasGrid';

describe('isInstrumentEmpty', () => {
  const none = { hasCircuit: false, hasCampaignData: false };
  it('follows the data each instrument draws from', () => {
    expect(isInstrumentEmpty('timeline', none)).toBe(true);
    expect(isInstrumentEmpty('timeline', { ...none, hasCircuit: true })).toBe(false);
    expect(isInstrumentEmpty('campaign-center', none)).toBe(true);
    expect(isInstrumentEmpty('campaign-center', { ...none, hasCampaignData: true })).toBe(false);
  });
  it('treats the placeholder instruments as empty', () => {
    expect(isInstrumentEmpty('stream-health', { hasCircuit: true, hasCampaignData: true })).toBe(true);
    expect(isInstrumentEmpty('calibration-timeline', { hasCircuit: true, hasCampaignData: true })).toBe(true);
  });
});

describe('canvasGrid (qec-r-25)', () => {
  it('sizes every row to at least its content so cards cannot overlap', () => {
    expect(canvasGrid(4, false).gridTemplateRows).toBe('repeat(3, minmax(max-content, 1fr))');
  });
  it('lets the leading instrument span the other rows when there is data', () => {
    expect(canvasGrid(4, false).primaryRowSpan).toBe(3);
  });
  it('keeps the primary card to one row when everything is empty', () => {
    const grid = canvasGrid(3, true);
    expect(grid.compact).toBe(true);
    expect(grid.primaryRowSpan).toBe(1);
    expect(grid.gridTemplateRows).toBe('repeat(2, max-content)');
  });
  it('runs the last of an odd number of empty cards across both columns', () => {
    expect(canvasGrid(3, true).fullWidthIndex).toBe(2);
    expect(canvasGrid(2, true).fullWidthIndex).toBeNull();
    expect(canvasGrid(1, true).fullWidthIndex).toBeNull();
  });
});
