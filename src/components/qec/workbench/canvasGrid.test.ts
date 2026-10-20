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

describe('canvasGrid (qec-r-25, rq-r3-02)', () => {
  it('puts the other instruments in their own rail beside the leading one when there is data', () => {
    const grid = canvasGrid(4, false);
    expect(grid.railed).toBe(true);
    expect(grid.compact).toBe(false);
  });
  it('never makes the leading instrument span content-sized rows', () => {
    const grid = canvasGrid(4, false);
    expect(grid.primaryRowSpan).toBe(1);
    expect(grid.gridTemplateRows).toBe('max-content');
  });
  it('has no rail when the leading instrument is the only one', () => {
    expect(canvasGrid(1, false).railed).toBe(false);
  });
  it('keeps the primary card to one row when everything is empty', () => {
    const grid = canvasGrid(3, true);
    expect(grid.compact).toBe(true);
    expect(grid.railed).toBe(false);
    expect(grid.primaryRowSpan).toBe(1);
    expect(grid.gridTemplateRows).toBe('repeat(2, max-content)');
  });
  it('runs the last of an odd number of empty cards across both columns', () => {
    expect(canvasGrid(3, true).fullWidthIndex).toBe(2);
    expect(canvasGrid(2, true).fullWidthIndex).toBeNull();
    expect(canvasGrid(1, true).fullWidthIndex).toBeNull();
  });
});
