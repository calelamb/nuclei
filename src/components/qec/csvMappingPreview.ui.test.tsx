// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { CsvMappingPreview } from './CsvMappingPreview';
import { ThresholdPanel } from './ThresholdPanel';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const line = (id: string, meta: Record<string, unknown>, errors = 10) =>
  `100000,${errors},0,1,pymatching,${id},"${JSON.stringify(meta).replace(/"/g, '""')}",`;

const open = (r: ReturnType<typeof render>) => fireEvent.click(r.getByRole('button', { name: /Edit mapping/ }));

beforeEach(() => useQecCampaignStore.getState().reset());
afterEach(() => cleanup());

describe('CsvMappingPreview (qec-03, 09, 15, 19, 20)', () => {
  it('is one line after load, with the editor behind Edit mapping', () => {
    useQecCampaignStore.getState().loadFromCsv(
      [HEADER, ...[3, 5, 7].map((d) => line(`a${d}`, { d, p: 0.001, r: d }))].join('\n'), 'x.csv');
    const r = render(<CsvMappingPreview />);
    expect(r.queryByLabelText('Map p')).toBeNull();
    expect(r.getByText(/3 rows → 3 tasks/)).toBeTruthy();
    open(r);
    expect(r.getByLabelText('Map p')).toBeTruthy();
  });

  it('separates rejected rows from summed duplicates and pluralises', () => {
    const text = [HEADER, line('a', { d: 3, p: 0.001 }), '100000,x,0,1,m,b,"{}",', '100000,x,0,1,m,c,"{}",'].join('\n');
    useQecCampaignStore.getState().loadFromCsv(text, 'bad.csv');
    const r = render(<CsvMappingPreview />);
    expect(r.container.textContent).toMatch(/3 rows → 1 task ·/);
    expect(r.container.textContent).toMatch(/2 rejected/);
    expect(r.container.textContent).not.toMatch(/duplicate strong_ids summed/);
  });

  it('offers merge or split on a collision and applies the choice', () => {
    const rows = [3, 5].flatMap((d) => [0.001, 0.002].flatMap((p) => [0, 1].map((k) =>
      line(`${d}-${p}-${k}`, { d, p, r: d, trial_tag: k }))));
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...rows].join('\n'), 'c.csv');
    const store = useQecCampaignStore.getState();
    store.setCsvMapping({ ...store.csvImport!.mapping, groupBy: [], mergeKeys: [] });
    const r = render(<CsvMappingPreview />);
    fireEvent.click(r.getByRole('button', { name: /Merge as replicates/ }));
    const mapping = useQecCampaignStore.getState().csvImport!.mapping;
    expect(mapping.mergeKeys).toEqual(['trial_tag']);
    expect(Object.keys(useQecCampaignStore.getState().rowsByStrongId)).toHaveLength(4);
    expect(r.queryByRole('button', { name: /Split by/ })).toBeNull();
  });

  it('says how many points remain after summing seeds, instead of a bare task count (qec-quality)', () => {
    const rows = [3, 5].flatMap((d) => [0.001, 0.002].flatMap((p) => [0, 1, 2].map((k) =>
      line(`${d}-${p}-${k}`, { d, p, r: d, seed: k }))));
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...rows].join('\n'), 's.csv');
    const store = useQecCampaignStore.getState();
    store.setCsvMapping({ ...store.csvImport!.mapping, groupBy: [], mergeKeys: ['seed'] });
    const r = render(<CsvMappingPreview />);
    expect(r.container.textContent).toMatch(/12 rows → 12 tasks · 4 plottable after summing seed replicates/);
  });

  it('stops saying p was guessed once the person picks the column', () => {
    const rows = [0.1, 0.2, 0.3].map((s, i) => line(`s${i}`, { d: 3 + 2 * i, strength: s, other: i }));
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...rows].join('\n'), 'g.csv');
    const r = render(<CsvMappingPreview />);
    expect(r.container.textContent).toMatch(/p was guessed/);
    open(r);
    fireEvent.change(r.getByLabelText('Map p'), { target: { value: 'other' } });
    expect(r.container.textContent).not.toMatch(/p was guessed/);
  });

  it('lists only varying keys to split by and shows constants as read-only chips', () => {
    const rows = [3, 5, 7].map((d) => line(`a${d}`, { d, p: 0.001, r: d, b: 'X', c: 'surface', q: d * 2 }));
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...rows].join('\n'), 'k.csv');
    const r = render(<CsvMappingPreview />);
    open(r);
    expect(r.queryByLabelText('Group series by b')).toBeNull();
    expect(r.getByText('b = X')).toBeTruthy();
    expect(r.getByText('c = surface')).toBeTruthy();
    const decoderOptions = [...(r.getByLabelText('Map decoder') as HTMLSelectElement).options].map((o) => o.value);
    expect(decoderOptions).toContain('b');
    expect(decoderOptions).not.toContain('d');
  });
});

describe('dead ends (qec-16)', () => {
  it('does not show a second drop zone while a file is loaded but unplottable', () => {
    const text = [HEADER, line('a', { d: 3 })].join('\n');
    useQecCampaignStore.getState().loadFromCsv(text, 'n.csv');
    const r = render(<ThresholdPanel />);
    expect(r.queryByTestId('csv-drop-zone')).toBeNull();
  });

  it('draws the series-split controls with the shared Checkbox and sets p in the sans face (rq-r3-12)', () => {
    const rows = [3, 5].map((d) => line(`a${d}`, { d, p: 0.001, r: d, trial_tag: d }));
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...rows].join('\n'), 'x.csv');
    const store = useQecCampaignStore.getState();
    store.setCsvMapping({ ...store.csvImport!.mapping, groupBy: [], mergeKeys: [] });
    const r = render(<CsvMappingPreview />);
    open(r);
    const boxes = Array.from(r.container.querySelectorAll('input[type="checkbox"]'));
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box.closest('label')?.className).toContain('nuclei-checkbox');
    const table = r.getByRole('table', { name: 'Mapped rows preview' });
    const pCell = Array.from(table.querySelectorAll('tbody tr:first-child td'))[4] as HTMLElement;
    expect(pCell.textContent).toBe('1×10⁻³');
    expect(pCell.className).toContain('nuclei-table__text');
    expect(pCell.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('previews five rows with a count of the rest so the editor stays short (rq-r3-05)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => line(`r${i}`, { d: 3, p: 0.001 * (i + 1), r: 3 }));
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...rows].join('\n'), 'x.csv');
    const r = render(<CsvMappingPreview />);
    open(r);
    const table = r.getByRole('table', { name: 'Mapped rows preview' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(r.getByText('Showing the first 5 of 12 rows.')).toBeTruthy();
  });
});
