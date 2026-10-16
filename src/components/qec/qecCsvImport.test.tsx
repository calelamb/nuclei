// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import golden from '../../types/__fixtures__/sinter_golden.json';
import { ThresholdPanel } from './ThresholdPanel';
import { CsvMappingPreview } from './CsvMappingPreview';
import { QecAnalysisView } from './QecAnalysisView';
import { likelihoodSeries } from '../../lib/qecFit';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

const webBuild = vi.hoisted(() => ({ value: false }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => webBuild.value }));
vi.mock('../../services/experimentExport', () => ({ downloadCsv: vi.fn(), downloadSvg: vi.fn() }));

const csv = golden.cases[0].csv;
function csvFile(text: string, name = 'stats.csv'): File {
  const f = new File([text], name, { type: 'text/csv' });
  if (typeof f.text !== 'function') Object.defineProperty(f, 'text', { value: async () => text });
  return f;
}
const dropFiles = (el: Element, files: File[]) =>
  fireEvent.drop(el, { dataTransfer: { files, types: ['Files'] } });

beforeEach(() => { webBuild.value = false; useQecCampaignStore.getState().reset(); });
afterEach(() => cleanup());

describe('CSV drop on the empty threshold panel', () => {
  it('shows a drop zone, then plots the dropped sinter CSV', async () => {
    const { getByTestId, container } = render(<ThresholdPanel />);
    expect(container.querySelectorAll('polyline').length).toBe(0);
    await act(async () => { dropFiles(getByTestId('csv-drop-zone'), [csvFile(csv)]); });
    await waitFor(() => expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0));
    // 2 distances at p=0.001 (resume duplicates folded) -> d3, d5 pymatching series
    expect(container.querySelectorAll('polyline').length).toBe(2);
  });

  it('shows a visible error for a non-sinter file and keeps the zone', async () => {
    const { getByTestId, findByRole } = render(<QecAnalysisView />);
    await act(async () => { dropFiles(getByTestId('csv-drop-zone'), [csvFile('a,b\n1,2')]); });
    expect((await findByRole('alert')).textContent).toMatch(/missing column/);
  });

  it('accepts a file from the picker input', async () => {
    const { getByLabelText, container } = render(<ThresholdPanel />);
    const input = getByLabelText('Choose sinter stats CSV') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [csvFile(csv)] } }); });
    await waitFor(() => expect(container.querySelectorAll('polyline').length).toBe(2));
  });

  it('ignores non-file drags', () => {
    const { getByTestId } = render(<ThresholdPanel />);
    fireEvent.drop(getByTestId('csv-drop-zone'), { dataTransfer: { files: [], types: ['text/plain'] } });
    expect(useQecCampaignStore.getState().csvImport).toBeNull();
  });
});

describe('CsvMappingPreview', () => {
  function Both() { return (<><CsvMappingPreview /><ThresholdPanel /></>); }
  const NON_STANDARD = [
    'shots,errors,discards,seconds,decoder,strong_id,json_metadata',
    ...[3, 5].flatMap((d) => [0.001, 0.002].map((n, i) =>
      `1000,${d * 2 + i},0,0.1,pymatching,${d}-${n},"{""distance"":${d},""noise"":${n},""other"":${i + 7}}"`)),
  ].join('\n');

  it('guesses the mapping, previews rows, and re-plots when a key changes', () => {
    useQecCampaignStore.getState().loadFromCsv(NON_STANDARD, 'x.csv');
    const { getByLabelText, container, getAllByRole } = render(<Both />);
    expect((getByLabelText('Map p') as HTMLSelectElement).value).toBe('noise');
    expect((getByLabelText('Map d') as HTMLSelectElement).value).toBe('distance');
    expect(getAllByRole('row').length).toBe(1 + 4); // header + 4 rows (<= 10)
    expect(container.querySelectorAll('polyline').length).toBe(2);

    // Make "distance" the x-axis: each (distance) becomes a single point per series
    fireEvent.change(getByLabelText('Map p'), { target: { value: 'other' } });
    expect(useQecCampaignStore.getState().csvImport?.mapping.p).toBe('other');
    const { rowsByStrongId } = useQecCampaignStore.getState();
    const noises = likelihoodSeries(Object.values(rowsByStrongId)).series.flatMap((s) => s.points.map((p) => p.noise));
    expect([...new Set(noises)].sort()).toEqual([7, 8]); // x values now come from "other"
    expect(container.querySelectorAll('polyline').length).toBe(2);
  });

  it('clearing p leaves nothing plottable (empty state returns)', () => {
    useQecCampaignStore.getState().loadFromCsv(NON_STANDARD, 'x.csv');
    const { getByLabelText, container } = render(<Both />);
    fireEvent.change(getByLabelText('Map p'), { target: { value: '' } });
    expect(container.querySelectorAll('polyline').length).toBe(0);
  });

  it('lists row problems visibly', () => {
    const bad = `${NON_STANDARD}\n10,1,0,0.1,m,zzz,"{nope"`;
    useQecCampaignStore.getState().loadFromCsv(bad, 'x.csv');
    const { getByRole } = render(<CsvMappingPreview />);
    expect(within(getByRole('alert')).getByText(/json_metadata is not valid JSON/)).toBeTruthy();
  });

  it('renders nothing without a CSV import', () => {
    const { container } = render(<CsvMappingPreview />);
    expect(container.firstChild).toBeNull();
  });
});

describe('QecAnalysisView', () => {
  it('accepts a drop anywhere on the view and shows the mapping panel', async () => {
    const { container, findByLabelText } = render(<QecAnalysisView />);
    await act(async () => { dropFiles(container.firstChild as Element, [csvFile(csv, 'campaign.csv')]); });
    expect(await findByLabelText('Map p')).toBeTruthy();
    expect(container.textContent).toContain('campaign.csv');
  });

  it('desktop shows Run campaign; the web build hides it (no kernel in the browser)', () => {
    const desktop = render(<QecAnalysisView />);
    expect(desktop.queryByText(/Run campaign/)).toBeTruthy();
    cleanup();
    webBuild.value = true;
    const web = render(<QecAnalysisView />);
    expect(web.queryByText(/Run campaign/)).toBeNull();
    expect(web.getByLabelText('Choose sinter stats CSV')).toBeTruthy();
  });
});
