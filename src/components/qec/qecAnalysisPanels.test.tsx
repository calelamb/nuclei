// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import campaignCsv from './__fixtures__/campaign_stats.csv?raw';
import { ThresholdPanel } from './ThresholdPanel';
import { DecoderWorkbench } from './DecoderWorkbench';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { parseSinterCsv } from '../../types/qecStats';

const downloadCsv = vi.fn();
const downloadSvg = vi.fn();
vi.mock('../../services/experimentExport', () => ({
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
  downloadSvg: (...a: unknown[]) => downloadSvg(...a),
}));

function loadCampaign() {
  const rows = parseSinterCsv(campaignCsv);
  const map: Record<string, (typeof rows)[number]> = {};
  for (const r of rows) map[r.strong_id] = r;
  useQecCampaignStore.setState({ rowsByStrongId: map, statsCsv: campaignCsv, running: false });
}

afterEach(() => cleanup());
beforeEach(() => {
  downloadCsv.mockClear();
  downloadSvg.mockClear();
  useQecCampaignStore.getState().reset();
});

describe('DecoderWorkbench', () => {
  it('shows one row per decoder with LER, shots, errors, time/shot and exports CSV', () => {
    loadCampaign();
    const { getByText, getAllByText, getByRole } = render(<DecoderWorkbench />);
    expect(getByText('pymatching')).toBeTruthy();
    expect(getByText('fusion_blossom')).toBeTruthy();
    // 80,000 pooled shots per decoder (both decoders → two cells).
    expect(getAllByText('80,000').length).toBe(2);
    fireEvent.click(getByRole('button', { name: 'Export CSV' }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv.mock.calls[0][0]).toContain('decoder,logical_error_rate');
  });

  it('shows an empty state with no campaign results', () => {
    const { getByText } = render(<DecoderWorkbench />);
    expect(getByText('No campaign results yet')).toBeTruthy();
  });
});

describe('ThresholdPanel', () => {
  it('renders a log-log chart with a series polyline per group and a Λ readout', () => {
    loadCampaign();
    const { container, getAllByText } = render(<ThresholdPanel />);
    expect(container.querySelector('svg')).toBeTruthy();
    // One polyline per (label×distance×decoder) series = 4.
    expect(container.querySelectorAll('polyline').length).toBe(4);
    // Λ readouts for both decoders (pymatching appears in legend + Λ line).
    expect(getAllByText(/pymatching/).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Λ =/).length).toBe(2);
  });

  it('exports SVG and CSV', () => {
    loadCampaign();
    const { getByRole } = render(<ThresholdPanel />);
    fireEvent.click(getByRole('button', { name: 'Export SVG' }));
    fireEvent.click(getByRole('button', { name: 'Export CSV' }));
    expect(downloadSvg).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state with no campaign results', () => {
    const { getByText } = render(<ThresholdPanel />);
    expect(getByText('No campaign results yet')).toBeTruthy();
  });
});
