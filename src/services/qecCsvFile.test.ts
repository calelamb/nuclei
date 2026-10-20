import { describe, it, expect, beforeEach, vi } from 'vitest';
import golden from '../types/__fixtures__/sinter_golden.json';
import { loadCsvFile } from './qecCsvFile';
import * as parseClient from './qecCsvParseClient';
import { useQecCampaignStore } from '../stores/qecCampaignStore';
import { MAX_CSV_BYTES } from '../types/sinterCsv';

beforeEach(() => useQecCampaignStore.getState().reset());

describe('loadCsvFile', () => {
  it('loads a file into the store', async () => {
    const res = await loadCsvFile({ name: 'a.csv', size: 10, text: async () => golden.cases[0].csv });
    expect(res.ok).toBe(true);
    expect(useQecCampaignStore.getState().csvImport?.sourceName).toBe('a.csv');
  });

  it('parses through the off-thread parser so big files never freeze the UI', async () => {
    const offThread = vi.spyOn(parseClient, 'prepareSinterCsvOffThread');
    const res = await loadCsvFile({ name: 'b.csv', size: 10, text: async () => golden.cases[0].csv });
    expect(res.ok).toBe(true);
    expect(offThread).toHaveBeenCalledTimes(1);
    offThread.mockRestore();
  });

  it('still refuses to load while a campaign is running, with the parse result discarded', async () => {
    useQecCampaignStore.setState({ running: true });
    const res = await loadCsvFile({ name: 'b.csv', size: 10, text: async () => golden.cases[0].csv });
    expect(res.ok).toBe(false);
    expect(res.fatal).toMatch(/campaign is running/);
    useQecCampaignStore.setState({ running: false });
  });

  it('refuses oversized files without reading them', async () => {
    const text = vi.fn(async () => '');
    const res = await loadCsvFile({ name: 'big.csv', size: MAX_CSV_BYTES + 1, text });
    expect(res.ok).toBe(false);
    expect(text).not.toHaveBeenCalled();
    expect(useQecCampaignStore.getState().csvError).toMatch(/too large/);
  });

  it('surfaces read failures instead of throwing', async () => {
    const res = await loadCsvFile({ name: 'x.csv', size: 1, text: async () => { throw new Error('denied'); } });
    expect(res.ok).toBe(false);
    expect(useQecCampaignStore.getState().csvError).toMatch(/denied/);
  });
});
