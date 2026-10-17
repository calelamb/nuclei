// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseSinterCsvDetailed, serializeSinterCsv } from './sinterCsv';
import { qecRatesToCsv } from '../lib/qecExport';
import { useQecCampaignStore } from '../stores/qecCampaignStore';

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const good = (id: string, d: number) => `1000,10,0,1,pymatching,${id},"{""d"":${d},""p"":0.001}",`;

beforeEach(() => useQecCampaignStore.getState().reset());

describe('rejected rows are counted apart from merged ones (qec-15)', () => {
  it('counts invalid rows as rejected, not merged', () => {
    const text = [HEADER, good('a', 3), 'x,1,0,1,pymatching,b,"{}",', 'x,1,0,1,pymatching,c,"{}",'].join('\n');
    const parsed = parseSinterCsvDetailed(text);
    expect(parsed.totalDataRows).toBe(3);
    expect(parsed.rejectedRows).toBe(2);
    expect(parsed.rows).toHaveLength(1);
  });

  it('reports a conflicting strong_id as rejected', () => {
    const text = [HEADER, good('a', 3), good('a', 5)].join('\n');
    expect(parseSinterCsvDetailed(text).rejectedRows).toBe(1);
  });
});

describe('dead ends (qec-16)', () => {
  it('a header-only file is a fatal error', () => {
    expect(parseSinterCsvDetailed(`${HEADER}\n`).fatal).toMatch(/header but no data rows/);
  });

  it('metadata without numeric keys is rejected with the expected shape', () => {
    const text = [HEADER, '1000,10,0,1,pymatching,a,"{""basis"":""X""}",'].join('\n');
    const res = useQecCampaignStore.getState().loadFromCsv(text, 'nometa.csv');
    expect(res.ok).toBe(false);
    expect(res.fatal).toMatch(/no numeric keys/);
    expect(res.fatal).toMatch(/basis/);
    expect(res.fatal).toMatch(/"d":5,"p":0\.001/);
    expect(useQecCampaignStore.getState().csvImport).toBeNull();
  });
});

describe('Nuclei plot export re-imports (qec-17)', () => {
  it('reads its own CSV export', () => {
    const rows = parseSinterCsvDetailed([HEADER, good('a', 3), good('b', 5)].join('\n')).rows;
    const exported = qecRatesToCsv(rows, { units: 'per_shot' });
    const back = parseSinterCsvDetailed(exported);
    expect(back.fatal).toBeNull();
    expect(back.rows.map((r) => r.strong_id).sort()).toEqual(['a', 'b']);
    expect(back.rows[0].shots).toBe(1000);
    expect(serializeSinterCsv(back.rows)).toContain('pymatching');
  });

  it('keeps naming the previous file when a later load fails', () => {
    const store = useQecCampaignStore.getState();
    store.loadFromCsv([HEADER, good('a', 3), good('b', 5), good('c', 7)].join('\n'), 'big.csv');
    const res = useQecCampaignStore.getState().loadFromCsv('a,b\n1,2', 'junk.csv');
    expect(res.ok).toBe(false);
    expect(useQecCampaignStore.getState().csvImport?.sourceName).toBe('big.csv');
  });
});
