// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ThresholdPanel } from './ThresholdPanel';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { parseSinterCsvDetailed } from '../../types/sinterCsv';

const downloadCsv = vi.fn();
const downloadSvg = vi.fn();
vi.mock('../../services/experimentExport', () => ({
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
  downloadSvg: (...a: unknown[]) => downloadSvg(...a),
}));

/** r=d and r=3d families under one label; a per-task `seed` nobody groups by. */
function buildCsv(): string {
  const errs: Record<number, number[]> = { 3: [900, 700], 5: [300, 230], 7: [100, 75] };
  const lines = ['shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts'];
  let seed = 0;
  for (const [mult, col] of [[1, 0], [3, 1]] as const) {
    for (const d of [3, 5, 7]) {
      seed += 1;
      const meta = JSON.stringify({ distance: d, noise: 0.002, num_rounds: d * mult, label: 'fam', seed });
      lines.push(`100000,${errs[d][col]},2000,1,pymatching,id-${mult}-${d},"${meta.replace(/"/g, '""')}","{""n_dets"":${seed}}"`);
    }
  }
  return lines.join('\n');
}

beforeEach(() => { downloadCsv.mockClear(); downloadSvg.mockClear(); useQecCampaignStore.getState().reset(); });
afterEach(() => cleanup());

describe('Wave A: dropped sinter CSV -> mapping -> corrected statistics -> matching export', () => {
  it('maps rounds, splits experiments once, offers per-round, and exports provenance', () => {
    const res = useQecCampaignStore.getState().loadFromCsv(buildCsv(), 'fam.csv');
    expect(res.ok).toBe(true);
    const imp = useQecCampaignStore.getState().csvImport!;
    expect(imp.mapping.rounds).toBe('num_rounds');
    expect(imp.mapping.groupBy).toEqual([]); // seed does not collide, so it is not grouped on

    const { container, getByRole } = render(<ThresholdPanel />);
    // r=d and r=3d are two experiments x 3 distances; seed did not split them further.
    expect(container.querySelectorAll('polyline').length).toBe(6);
    const meta = () => JSON.parse(container.querySelector('svg metadata')!.textContent!);
    expect(meta().lambda_estimates).toHaveLength(2);
    expect(meta().lambda_estimates.every((e: { distances: number[] }) => e.distances.length === 3)).toBe(true);
    expect(container.textContent).toMatch(/Λ = /);

    // per-round toggle exists because rounds are mapped
    fireEvent.click(getByRole('button', { name: 'Per round' }));
    expect(meta().units).toBe('logical error per round');

    fireEvent.click(getByRole('button', { name: 'Export CSV' }));
    const csv = downloadCsv.mock.calls[0][0] as string;
    const [header, ...lines] = csv.trim().split('\n');
    expect(header).toMatch(/discards.*strong_id,json_metadata,custom_counts$/);
    expect(lines).toHaveLength(6);
    expect(csv).toContain('per_round');
    expect(csv).toContain('id-3-7');
    expect(csv).toContain('""n_dets"":6'); // custom_counts survives
    expect(csv).toContain('""num_rounds"":21'); // original metadata, not the mapped copy
    expect(csv).not.toContain('__nuclei_mapping');
    expect(csv).toContain(',2000,98000,'); // discards and kept shots
  });

  it('clearing the rounds mapping removes the per-round toggle and unit choice', () => {
    useQecCampaignStore.getState().loadFromCsv(buildCsv(), 'fam.csv');
    const store = useQecCampaignStore.getState();
    store.setCsvMapping({ ...store.csvImport!.mapping, rounds: null });
    const { queryByRole } = render(<ThresholdPanel />);
    expect(queryByRole('button', { name: 'Per round' })).toBeNull();
  });

  it('parse keeps custom_counts and discards in the loaded rows', () => {
    const parsed = parseSinterCsvDetailed(buildCsv());
    expect(parsed.rows[0].discards).toBe(2000);
    expect(parsed.rows[0].custom_counts).toEqual({ n_dets: 1 });
  });
});
