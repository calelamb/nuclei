// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { ThresholdPanel } from './ThresholdPanel';
import { DecoderWorkbench } from './DecoderWorkbench';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import type { QecCampaignStatsRow } from '../../types/qec';

vi.mock('../../services/experimentExport', () => ({ downloadCsv: vi.fn(), downloadSvg: vi.fn() }));

const rows: QecCampaignStatsRow[] = [3, 5, 7].map((d, i) => ({
  strong_id: `r${d}`, decoder: 'pymatching', shots: 100000, errors: [1000, 300, 90][i], discards: 0, seconds: 1,
  custom_counts: {}, json_metadata: { d, p: 0.002, r: d },
}));

beforeEach(() => {
  useQecCampaignStore.getState().reset();
  useQecCampaignStore.setState({ rowsByStrongId: Object.fromEntries(rows.map((r) => [r.strong_id, r])) });
});
afterEach(() => cleanup());

describe('shared units (qec-12, qec-21)', () => {
  it('the decoder table follows the plot toggle', () => {
    const plot = render(<ThresholdPanel />);
    const table = render(<DecoderWorkbench />);
    expect(table.container.textContent).toMatch(/Logical error rate \(per round\)/);
    fireEvent.click(within(plot.container).getByRole('radio', { name: 'Per shot' }));
    expect(table.container.textContent).toMatch(/Logical error rate \(per shot\)/);
  });

  it('puts the same units control in the decoder table header so the Decoders tab can switch too (qec-r-34)', () => {
    const table = render(<DecoderWorkbench />);
    fireEvent.click(within(table.container).getByRole('radio', { name: 'Per shot' }));
    expect(table.container.textContent).toMatch(/Logical error rate \(per shot\)/);
  });

  it('keeps the choice after leaving and coming back', () => {
    const first = render(<ThresholdPanel />);
    fireEvent.click(first.getByRole('radio', { name: 'Per shot' }));
    first.unmount();
    const again = render(<ThresholdPanel />);
    expect(again.getByRole('radio', { name: 'Per shot' }).getAttribute('aria-checked')).toBe('true');
  });
});
