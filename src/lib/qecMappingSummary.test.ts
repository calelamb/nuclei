import { describe, expect, it } from 'vitest';
import { DECODER_COLUMN, type SinterMapping } from '../types/sinterMapping';
import { describeMapping } from './qecMappingSummary';

const base: SinterMapping = { p: 'p', d: 'd', rounds: 'r', decoder: DECODER_COLUMN, groupBy: [] };

describe('describeMapping', () => {
  it('lists each mapped field and names the decoder column', () => {
    expect(describeMapping(base)).toBe('p = p · d = d · rounds = r · series by decoder column');
  });

  it('says so when a field is unmapped rather than hiding it', () => {
    expect(describeMapping({ ...base, p: null, rounds: null })).toBe('p unmapped · d = d · rounds unmapped · series by decoder column');
  });

  it('includes decoder metadata keys and split keys', () => {
    expect(describeMapping({ ...base, decoder: 'dec', groupBy: ['basis', 'noise'] })).toBe(
      'p = p · d = d · rounds = r · series by dec · split by basis, noise',
    );
  });
});
