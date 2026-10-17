import { describe, expect, it } from 'vitest';
import { DECODER_COLUMN, type SinterMapping } from '../types/sinterMapping';
import { describeCounts, describeMapping } from './qecMappingSummary';

const base: SinterMapping = { p: 'p', d: 'd', rounds: 'r', decoder: DECODER_COLUMN, groupBy: [] };

describe('describeMapping', () => {
  it('lists only what departs from the defaults, in one notation', () => {
    expect(describeMapping(base)).toBe('rounds = r');
    expect(describeMapping({ ...base, p: 'q' })).toBe('p = q · rounds = r');
  });

  it('says columns matched by name when nothing departs', () => {
    expect(describeMapping({ ...base, rounds: 'rounds' })).toBe('columns matched by name');
  });

  it('says so when a field is unmapped rather than hiding it', () => {
    expect(describeMapping({ ...base, p: null, rounds: null })).toBe('p unmapped · rounds unmapped');
  });

  it('includes decoder metadata keys, split keys and replicate sums', () => {
    expect(describeMapping({ ...base, decoder: 'dec', groupBy: ['basis', 'noise'] })).toBe(
      'rounds = r · decoder = dec · split by basis, noise',
    );
    expect(describeMapping({ ...base, mergeKeys: ['seed'] })).toBe('rounds = r · seed summed as replicates');
  });
});

describe('describeCounts', () => {
  it('reports rows and tasks alone when nothing is merged', () => {
    expect(describeCounts({ totalDataRows: 48, tasks: 48, points: 48, mergeKeys: [] })).toBe('48 rows · 48 tasks');
  });

  it('says how many points remain once replicates are summed, so 3,600 tasks and 720 points are not a mystery', () => {
    expect(describeCounts({ totalDataRows: 3600, tasks: 3600, points: 720, mergeKeys: ['seed'] })).toBe(
      '3,600 rows · 3,600 tasks · 720 points after summing seed replicates',
    );
  });

  it('uses singular nouns', () => {
    expect(describeCounts({ totalDataRows: 1, tasks: 1, points: 1, mergeKeys: [] })).toBe('1 row · 1 task');
  });
});
