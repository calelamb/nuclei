import { describe, it, expect } from 'vitest';
import { updateBannerOffsets } from './updateBannerOffsets';

describe('updateBannerOffsets', () => {
  it('sits above the status bar', () => {
    expect(updateBannerOffsets(true, 320).bottom).toBeGreaterThanOrEqual(24);
  });
  it('sits left of an open Dirac panel so it never covers the composer', () => {
    expect(updateBannerOffsets(true, 320).right).toBe(332);
  });
  it('hugs the rail tab when Dirac is collapsed', () => {
    expect(updateBannerOffsets(false, 320).right).toBe(40);
  });
});
