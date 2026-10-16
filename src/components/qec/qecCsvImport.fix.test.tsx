// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import golden from '../../types/__fixtures__/sinter_golden.json';
import { ThresholdPanel } from './ThresholdPanel';
import { CsvMappingPreview } from './CsvMappingPreview';
import { QecAnalysisView } from './QecAnalysisView';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { likelihoodSeries } from '../../lib/qecFit';
import { parseSinterCsvDetailed } from '../../types/sinterCsv';
import * as exporter from '../../services/experimentExport';

const webBuild = vi.hoisted(() => ({ value: false }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => webBuild.value }));
vi.mock('../../services/experimentExport', () => ({ downloadCsv: vi.fn(), downloadSvg: vi.fn() }));

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const BASIS_CSV = [
  HEADER,
  ...[['X', 3, 100], ['X', 5, 10], ['Z', 3, 50], ['Z', 5, 45]].map(([b, d, e]) =>
    `10000,${e},0,1,pymatching,${b}${d},"{""basis"":""${b}"",""d"":${d},""p"":0.001}",`),
].join('\n');
const goldenCsv = golden.cases[0].csv;

function csvFile(text: string, name = 'stats.csv'): File {
  const f = new File([text], name, { type: 'text/csv' });
  if (typeof f.text !== 'function') Object.defineProperty(f, 'text', { value: async () => text });
  return f;
}
const dropFiles = (el: Element, files: File[]) =>
  fireEvent.drop(el, { dataTransfer: { files, types: ['Files'] } });

beforeEach(() => { webBuild.value = false; useQecCampaignStore.getState().reset(); vi.clearAllMocks(); });
afterEach(() => cleanup());

describe('unmapped metadata keys no longer merge series silently', () => {
  it('auto-groups basis X/Z into separate series with no collision warning', () => {
    useQecCampaignStore.getState().loadFromCsv(BASIS_CSV, 'b.csv');
    const { queryByText } = render(<CsvMappingPreview />);
    expect(likelihoodSeries(Object.values(useQecCampaignStore.getState().rowsByStrongId)).series).toHaveLength(4);
    expect(queryByText(/share one plotted point/)).toBeNull();
    expect(useQecCampaignStore.getState().csvImport?.mapping.groupBy).toEqual(['basis']);
  });

  it('warns visibly when the user removes the group-by and tasks collide', () => {
    useQecCampaignStore.getState().loadFromCsv(BASIS_CSV, 'b.csv');
    const { getByLabelText, getAllByRole } = render(<CsvMappingPreview />);
    fireEvent.click(getByLabelText('Group series by basis'));
    expect(useQecCampaignStore.getState().csvImport?.mapping.groupBy).toEqual([]);
    const alerts = getAllByRole('alert').map((a) => a.textContent).join(' | ');
    expect(alerts).toMatch(/2 plotted points are shared by more than one task/);
    expect(alerts).toMatch(/"basis".*splits the tasks into blocks/);
  });
});

describe('CSV errors are always visible', () => {
  it('shows a whole-file error while Nuclei campaign results are on screen', async () => {
    useQecCampaignStore.getState().finishCampaign('', parseSinterCsvDetailed(goldenCsv).rows);
    const { container, findByRole } = render(<QecAnalysisView />);
    await act(async () => { dropFiles(container.firstChild as Element, [csvFile('a,b\n1,2')]); });
    expect((await findByRole('alert')).textContent).toMatch(/Not a sinter stats CSV/);
  });
});

describe('one drop loads once', () => {
  it('drop on the empty-state zone parses the file a single time', async () => {
    const spy = vi.spyOn(useQecCampaignStore.getState(), 'loadFromCsv');
    const { getByTestId } = render(<QecAnalysisView />);
    await act(async () => { dropFiles(getByTestId('csv-drop-zone'), [csvFile(goldenCsv)]); });
    await waitFor(() => expect(useQecCampaignStore.getState().csvImport).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('sinter-native export', () => {
  it('exports stats.csv that round-trips discards, custom_counts and strong_id', async () => {
    const { getByLabelText, findByText } = render(<QecAnalysisView />);
    await act(async () => { fireEvent.change(getByLabelText('Choose sinter stats CSV'), { target: { files: [csvFile(goldenCsv)] } }); });
    fireEvent.click(await findByText('Export stats.csv'));
    const [text, name] = vi.mocked(exporter.downloadCsv).mock.calls[0];
    expect(name).toBe('stats.csv');
    const back = parseSinterCsvDetailed(text).rows;
    const exp = golden.cases[0].expected;
    expect(back.map((r) => [r.strong_id, r.discards, r.custom_counts])).toEqual(
      exp.map((r) => [r.strong_id, r.discards, r.custom_counts]));
    expect(back.map((r) => r.json_metadata)).toEqual(exp.map((r) => r.json_metadata));
  });
});

describe('postselection and guess caveats', () => {
  it('does not claim rates ignore discards (the figure uses shots - discards)', () => {
    useQecCampaignStore.getState().loadFromCsv(goldenCsv, 'g.csv');
    const { queryByText } = render(<CsvMappingPreview />);
    expect(queryByText(/errors\/shots, not/)).toBeNull();
    expect(queryByText(/read lower here/)).toBeNull();
  });

  it('flags a fallback p guess as low confidence', () => {
    const csv = [HEADER, '100,1,0,1,m,a,"{""d"":3,""q"":0.1}",', '100,1,0,1,m,b,"{""d"":3,""q"":0.2}",'].join('\n');
    useQecCampaignStore.getState().loadFromCsv(csv, 'q.csv');
    const { getByText } = render(<CsvMappingPreview />);
    expect(getByText(/guessed: "q" is not a conventional name/)).toBeTruthy();
  });
});

describe('empty-state copy', () => {
  it('does not tell web users to run a campaign', () => {
    webBuild.value = true;
    const { container } = render(<ThresholdPanel />);
    expect(container.textContent).not.toMatch(/Run a QEC campaign/);
    expect(container.textContent).toMatch(/Drop a sinter stats CSV/);
  });

  it('points at the mapping when a CSV is loaded but nothing is plottable', () => {
    const csv = [HEADER, '100,1,0,1,m,a,"{""d"":3}",'].join('\n');
    useQecCampaignStore.getState().loadFromCsv(csv, 'n.csv');
    const { container } = render(<ThresholdPanel />);
    expect(container.textContent).toMatch(/Nothing to plot yet.*choose a numeric column for p/);
  });
});
