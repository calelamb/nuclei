// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { CsvMappingPreview } from './CsvMappingPreview';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const line = (id: string, m: object) => `1000,5,0,1,pymatching,${id},"${JSON.stringify(m).replace(/"/g, '""')}",`;
const csv = [HEADER, ...[3, 5, 7].flatMap((d) => [1, 2].map((i) => line(`${d}-${i}`, { d, p: i / 1000, q: 20 * i * d })))].join('\n');

beforeEach(() => { useQecCampaignStore.getState().reset(); useQecCampaignStore.getState().loadFromCsv(csv, 'q.csv'); });
afterEach(cleanup);

describe('mapping a non-probability column to p (qec-r-13)', () => {
  it('stays quiet for a real probability column and labels the odd one out in the select', () => {
    render(<CsvMappingPreview />);
    fireEvent.click(screen.getByRole('button', { name: /Edit mapping/ }));
    expect(screen.queryByText(/not a physical error probability/)).toBeNull();
    expect(screen.getByRole('option', { name: 'q (not a probability)' })).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'p' }).length).toBeGreaterThan(0);
  });

  it('warns once p is mapped to a column with values outside 0 to 1', () => {
    render(<CsvMappingPreview />);
    fireEvent.click(screen.getByRole('button', { name: /Edit mapping/ }));
    fireEvent.change(screen.getByLabelText('Map p'), { target: { value: 'q' } });
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/"q" has values outside 0 to 1/);
  });
});
