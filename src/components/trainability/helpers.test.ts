import { describe, expect, it } from 'vitest';
import { runDisabledReason } from './targetBarMath';
import { zoomedFidelityDomain } from './tabs/histogramMath';
import { axisTicks } from './tabs/landscapeDraw';
import { expressibilityFixture } from '../../services/trainability/fixtures';

const base = { unavailable: false, running: false, chosenCount: 3, scalingInvalid: false, inspecting: false, noParameters: false };

describe('runDisabledReason', () => {
  it('is null when Run is enabled', () => {
    expect(runDisabledReason(base)).toBeNull();
    expect(runDisabledReason({ ...base, running: true })).toBeNull();
  });
  it('names the reason for each way Run can be disabled, m = 0 first', () => {
    expect(runDisabledReason({ ...base, noParameters: true, inspecting: true })).toMatch(/no free parameters \(m = 0\)/);
    expect(runDisabledReason({ ...base, chosenCount: 0 })).toMatch(/at least one analysis/);
    expect(runDisabledReason({ ...base, scalingInvalid: true })).toMatch(/scaling/);
    expect(runDisabledReason({ ...base, inspecting: true })).toMatch(/Inspecting/);
    expect(runDisabledReason({ ...base, unavailable: true })).toMatch(/kernel/);
  });
});

describe('zoomedFidelityDomain', () => {
  it('zooms a Haar-like histogram to where the mass is', () => {
    const [lo, hi] = zoomedFidelityDomain(expressibilityFixture.histogram);
    expect(lo).toBe(0);
    expect(hi).toBeLessThan(0.6);
    expect(hi).toBeGreaterThan(0);
  });
  it('keeps the full range for a flat or empty histogram', () => {
    expect(zoomedFidelityDomain([])).toEqual([0, 1]);
    const flat = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, observed: 0.1, haar: 0.1 }));
    expect(zoomedFidelityDomain(flat)).toEqual([0, 1]);
    expect(zoomedFidelityDomain(flat.map((b) => ({ ...b, observed: 0, haar: 0 })))).toEqual([0, 1]);
  });
});

describe('axisTicks', () => {
  it('labels the landscape axis at its ends and origin', () => {
    expect(axisTicks([-Math.PI, 0, Math.PI])).toEqual(['−3.1', '0', '3.1']);
    expect(axisTicks([0.5])).toEqual(['0']);
  });
});
