// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import campaignCsv from './__fixtures__/campaign_stats.csv?raw';
import syntheticCsv from '../../lib/__fixtures__/synthetic_rounds.csv?raw';
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
  it('renders a log-log chart with units, CI method, and no threshold claim', () => {
    loadCampaign();
    const { container, getAllByText, getByText, queryByText } = render(<ThresholdPanel />);
    expect(container.querySelector('svg')).toBeTruthy();
    // One polyline per (label×distance×decoder) series = 4.
    expect(container.querySelectorAll('polyline').length).toBe(4);
    expect(getAllByText(/pymatching/).length).toBeGreaterThanOrEqual(1);
    expect(getByText('logical error per shot')).toBeTruthy();
    expect(getByText(/sinter likelihood ratio/)).toBeTruthy();
    expect(queryByText(/Threshold/)).toBeNull();
    // Fixture has only 2 distances: Λ is withheld, not faked.
    expect(getAllByText(/Λ not estimated/).length).toBe(2);
    expect(queryByText(/Λ =/)).toBeNull();
  });

  it('embeds estimator/CI/unit metadata in the SVG', () => {
    loadCampaign();
    const { container } = render(<ThresholdPanel />);
    const meta = JSON.parse(container.querySelector('svg metadata')!.textContent!);
    expect(meta.units).toBe('logical error per shot');
    expect(meta.ci_method).toMatch(/fit_binomial/);
    expect(meta.lambda_estimator).toMatch(/ln\(LER\)/);
    expect(meta.rate_estimator).toMatch(/discards/);
  });

  it('with >= 3 distances and rounds: shows Λ with an interval and a working units toggle', () => {
    const rows = parseSinterCsv(syntheticCsv);
    const map: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) map[r.strong_id] = r;
    useQecCampaignStore.setState({ rowsByStrongId: map, statsCsv: syntheticCsv, running: false });
    const { getAllByText, getByText, getByRole } = render(<ThresholdPanel />);
    expect(getAllByText(/Λ = .* to /).length).toBeGreaterThan(0);
    expect(getByText('logical error per shot')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Per round' }));
    expect(getByText('logical error per round')).toBeTruthy();
    expect(getByRole('button', { name: 'Per round' }).getAttribute('aria-pressed')).toBe('true');
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
