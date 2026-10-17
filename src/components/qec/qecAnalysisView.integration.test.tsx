// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QecAnalysisView } from './QecAnalysisView';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { likelihoodSeries, rowRate } from '../../lib/qecFit';
import { formatRateInterval } from '../../lib/qecPlotFormat';
import { qecRatesToCsv } from '../../lib/qecExport';

const downloadCsv = vi.fn();
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));
vi.mock('../../services/experimentExport', () => ({
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
  downloadSvg: vi.fn(),
}));

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const line = (id: string, meta: Record<string, unknown>, errors: number, discards = 0) =>
  `100000,${errors},${discards},1,pymatching,${id},"${JSON.stringify(meta).replace(/"/g, '""')}",`;

const discardCsv = [HEADER, ...[3, 5, 7].map((d, i) => line(`x${d}`, { d, p: 0.01, r: d }, [1000, 330, 110][i], 90000))].join('\n');
const disjointCsv = [
  HEADER,
  ...[3, 5, 7].map((d, i) => line(`s${d}`, { code: 'surface', d, p: 0.01 }, [10000, 1000, 100][i])),
  ...[9, 11, 13].map((d, i) => line(`c${d}`, { code: 'color', d, p: 0.01 }, [8000, 4000, 2000][i])),
].join('\n');

beforeEach(() => { useQecCampaignStore.getState().reset(); downloadCsv.mockClear(); });
afterEach(() => cleanup());

describe('QecAnalysisView with a dropped CSV (every panel in one view)', () => {
  it('has one consistent statement about discards, and the workbench agrees with the figure', () => {
    useQecCampaignStore.getState().loadFromCsv(discardCsv, 'd.csv');
    const { container, getAllByRole } = render(<QecAnalysisView />);
    const text = container.textContent!;
    expect(text).not.toMatch(/errors\/shots, not/);
    expect(text).not.toMatch(/read lower here than in sinter/);
    expect(text).toMatch(/shots − discards/);
    // workbench row for d=3: 1000 errors / 10000 kept shots, in the plot's units (per round, r = 3)
    const { fit } = rowRate({ shots: 100000, errors: 1000, discards: 90000, json_metadata: { d: 3, p: 0.01, r: 3 } }, { units: 'per_round' });
    const expected = formatRateInterval(fit.best, fit.low, fit.high);
    const rows = container.querySelectorAll('tbody tr');
    expect([...rows].some((r) => r.textContent!.includes(expected))).toBe(true);
    expect(text).toMatch(/Logical error rate \(per round\)/);
    expect(getAllByRole('button', { name: 'Export decoder table (CSV)' }).length).toBeGreaterThanOrEqual(1);
  });

  it('exported rates equal the plotted values', () => {
    useQecCampaignStore.getState().loadFromCsv(discardCsv, 'd.csv');
    const rows = Object.values(useQecCampaignStore.getState().rowsByStrongId);
    const { series } = likelihoodSeries(rows, { units: 'per_shot' });
    const csv = qecRatesToCsv(rows, { units: 'per_shot' });
    const [header, ...lines] = csv.trim().split('\n');
    const col = header.split(',').indexOf('rate');
    const exported = lines.map((l) => Number(l.split(',')[col])).sort();
    const plotted = series.flatMap((s) => s.points.map((p) => p.rate.p)).sort();
    expect(exported).toEqual(plotted);
  });

  it('disjoint-grid experiments are split by the guess, so no partition alert and two Λ', () => {
    useQecCampaignStore.getState().loadFromCsv(disjointCsv, 'j.csv');
    expect(useQecCampaignStore.getState().csvImport!.mapping.groupBy).toEqual(['code']);
    const { container, queryByText } = render(<QecAnalysisView />);
    expect(queryByText(/splits? the tasks into blocks/)).toBeNull();
    const tables = container.querySelectorAll('[aria-label="Error suppression factor Λ"] table');
    expect(tables.length).toBeGreaterThanOrEqual(2);
  });

  it('unticking the partition key shows a visible alert instead of silently pooling', () => {
    useQecCampaignStore.getState().loadFromCsv(disjointCsv, 'j.csv');
    const { getByLabelText, getByRole } = render(<QecAnalysisView />);
    fireEvent.click(getByLabelText('Group series by code'));
    expect(getByRole('alert').textContent).toMatch(/code.*splits the tasks into blocks/s);
  });

  it('collision alert says colliding tasks are treated as replicates', () => {
    const dup = [HEADER, line('a', { d: 3, p: 0.01, k: 1 }, 10), line('b', { d: 3, p: 0.01, k: 2 }, 12)].join('\n');
    useQecCampaignStore.getState().loadFromCsv(dup, 'dup.csv');
    const store = useQecCampaignStore.getState();
    store.setCsvMapping({ ...store.csvImport!.mapping, groupBy: [] });
    const { container } = render(<QecAnalysisView />);
    expect(container.textContent).toMatch(/replicates/);
    expect(container.textContent).not.toMatch(/keeps only one task/);
  });
});
