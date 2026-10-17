import { describe, it, expect } from 'vitest';
import type { QecCampaignStatsRow } from '../types/qec';
import { checkProbabilityColumn, isNotProbability } from './qecProbability';
import { useQecCampaignStore } from '../stores/qecCampaignStore';

const row = (meta: Record<string, unknown>): QecCampaignStatsRow => ({
  strong_id: JSON.stringify(meta), decoder: 'pymatching', shots: 1000, errors: 3, discards: 0, seconds: 1, json_metadata: meta,
} as unknown as QecCampaignStatsRow);

describe('checkProbabilityColumn', () => {
  it('accepts probabilities, including 0 and 1', () => {
    const rows = [row({ p: 0 }), row({ p: 0.001 }), row({ p: 1 })];
    expect(checkProbabilityColumn(rows, 'p')).toMatchObject({ outside: 0, total: 3, min: 0, max: 1 });
    expect(isNotProbability(rows, 'p')).toBe(false);
  });
  it('flags values above 1 or below 0 and ignores non-numeric cells', () => {
    const rows = [row({ q: 20 }), row({ q: 100 }), row({ q: 'x' }), row({ q: 0.5 })];
    expect(checkProbabilityColumn(rows, 'q')).toMatchObject({ outside: 2, total: 3, min: 0.5, max: 100 });
    expect(isNotProbability(rows, 'q')).toBe(true);
    expect(isNotProbability([row({ q: -0.1 })], 'q')).toBe(true);
  });
  it('reads columns from a loaded CSV import in the store (qec-r-13)', () => {
    const header = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
    const line = (id: string, m: object) => `1000,5,0,1,pymatching,${id},"${JSON.stringify(m).replace(/"/g, '""')}",`;
    const csv = [header, line('a', { d: 3, p: 0.001, q: 20 }), line('b', { d: 3, p: 0.002, q: 100 })].join('\n');
    useQecCampaignStore.getState().reset();
    useQecCampaignStore.getState().loadFromCsv(csv, 'q.csv');
    const rows = useQecCampaignStore.getState().csvImport!.rows;
    expect(isNotProbability(rows, 'p')).toBe(false);
    expect(isNotProbability(rows, 'q')).toBe(true);
  });
});
