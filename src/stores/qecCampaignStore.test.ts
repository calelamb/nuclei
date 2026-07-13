import { describe, it, expect, beforeEach } from 'vitest';
import { useQecCampaignStore, currentCampaignRows } from './qecCampaignStore';
import type { QecCampaignStatsRow } from '../types/qec';

function statsRow(id: string, shots: number, errors: number): QecCampaignStatsRow {
  return { strong_id: id, decoder: 'pymatching', json_metadata: {}, shots, errors, discards: 0, seconds: 1, custom_counts: {} };
}

describe('qecCampaignStore (PRD 10 Phase E)', () => {
  beforeEach(() => {
    useQecCampaignStore.getState().reset();
  });

  it('startCampaign sets running + progress and clears prior stats', () => {
    useQecCampaignStore.setState({ statsCsv: 'old' });
    useQecCampaignStore.getState().startCampaign('surface-vs-rep', 12);
    const s = useQecCampaignStore.getState();
    expect(s.running).toBe(true);
    expect(s.campaignName).toBe('surface-vs-rep');
    expect(s.statsCsv).toBeNull();
    expect(s.progress).toEqual({ tasksComplete: 0, tasksTotal: 12, sampledShots: 0, statusMessage: 'starting…' });
  });

  it('mergeRows keys by strong_id — later totals OVERWRITE, never append (D5 contract)', () => {
    useQecCampaignStore.getState().startCampaign('c', 2);
    useQecCampaignStore.getState().mergeRows([statsRow('a', 100, 2)], { tasksComplete: 1 });
    useQecCampaignStore.getState().mergeRows([statsRow('a', 250, 5)], { tasksComplete: 1 }); // same task, more shots
    useQecCampaignStore.getState().mergeRows([statsRow('b', 100, 1)], { tasksComplete: 2 });
    const rows = currentCampaignRows(useQecCampaignStore.getState());
    expect(rows.length).toBe(2); // a (overwritten) + b, not 3
    const a = rows.find((r) => r.strong_id === 'a')!;
    expect(a.shots).toBe(250); // the later total won
    expect(useQecCampaignStore.getState().progress?.tasksComplete).toBe(2);
  });

  it('finishCampaign stores the sinter CSV and stops running', () => {
    useQecCampaignStore.getState().startCampaign('c', 1);
    useQecCampaignStore.getState().finishCampaign('shots,errors\n100,2\n', [statsRow('a', 100, 2)]);
    const s = useQecCampaignStore.getState();
    expect(s.running).toBe(false);
    expect(s.statsCsv).toContain('shots,errors');
    expect(currentCampaignRows(s).length).toBe(1);
  });

  it('tracks a resumable prior run', () => {
    useQecCampaignStore.getState().setResumable({ runDir: '20260712-aaaa', name: 'surface' });
    expect(useQecCampaignStore.getState().resumable).toEqual({ runDir: '20260712-aaaa', name: 'surface' });
    useQecCampaignStore.getState().setResumable(null);
    expect(useQecCampaignStore.getState().resumable).toBeNull();
  });
});
