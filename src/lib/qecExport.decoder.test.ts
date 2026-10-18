import { describe, it, expect } from 'vitest';
import { decoderTableToCsv } from './qecExport';
import type { DecoderComparison } from './qecWorkbench';

const comparison: DecoderComparison = {
  skipped: 0,
  maxLikelihoodFactor: 1000,
  rows: [{
    experiment: 'exp', context: '', decoder: 'pymatching', distance: 5, noise: 0.001,
    shots: 1000, discards: 0, kept: 1000, errors: 10, strongId: 'abc', collides: false,
    rate: { p: 0.0103759 + 1e-17 * 0, lo: 0.0054, hi: 0.010375899999999999 },
    units: 'per_shot', secondsPerShot: 0.30000000000000004,
  }],
};

describe('decoderTableToCsv', () => {
  it('rounds rates and timings to 8 significant figures like the plot export (qec-r-11)', () => {
    const csv = decoderTableToCsv(comparison);
    expect(csv).toContain(',0.0103759,');
    expect(csv).not.toMatch(/0\.010375899999/);
    expect(csv).toContain(',0.3,');
    expect(csv).not.toContain('0.30000000000000004');
  });

  it('keeps the documented header and one row per decoder', () => {
    const lines = decoderTableToCsv(comparison).trim().split('\n');
    expect(lines[0]).toMatch(/^decoder,experiment,distance,noise/);
    expect(lines).toHaveLength(2);
  });
});
