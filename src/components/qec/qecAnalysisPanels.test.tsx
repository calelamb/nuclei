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

  it('synthetic data: separate non-zigzag curves, Λ per experiment from 3 points, Λ in the SVG', () => {
    const rows = parseSinterCsv(syntheticCsv);
    const map: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) map[r.strong_id] = r;
    useQecCampaignStore.setState({ rowsByStrongId: map, statsCsv: syntheticCsv, running: false });
    const { container } = render(<ThresholdPanel />);
    const lines = [...container.querySelectorAll('polyline')];
    // 2 experiments (r=d, r=3d) x 3 distances, each a 3-point curve with one y per p.
    expect(lines).toHaveLength(6);
    for (const l of lines) {
      const xs = l.getAttribute('points')!.split(' ').map((pt) => Number(pt.split(',')[0]));
      expect(xs).toHaveLength(3);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      expect(new Set(xs).size).toBe(3);
    }
    const meta = JSON.parse(container.querySelector('svg metadata')!.textContent!);
    expect(meta.lambda_estimates).toHaveLength(6);
    expect(meta.lambda_estimates.map((e: { experiment: string }) => e.experiment)).toContain('synth r=3d');
    expect(container.querySelectorAll('svg text').length).toBeGreaterThan(6);
    expect(container.querySelector('svg[role="img"]')!.textContent).toMatch(/Λ = .* synth r=d|synth r=d.*Λ = /);
    expect(container.textContent).toMatch(/synth r=3d: Λ = /);
  });

  it('does not crash on malformed rows and says they were skipped', () => {
    const rows = parseSinterCsv(syntheticCsv);
    const map: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) map[r.strong_id] = r;
    map.bad = { ...rows[0], strong_id: 'bad', errors: rows[0].shots * 2 };
    useQecCampaignStore.setState({ rowsByStrongId: map, statsCsv: '', running: false });
    const { container } = render(<ThresholdPanel />);
    expect(container.textContent).toMatch(/1 malformed row/);
  });

  it('exports SVG and CSV', () => {
    loadCampaign();
    const { getByRole } = render(<ThresholdPanel />);
    fireEvent.click(getByRole('button', { name: 'Export SVG' }));
    fireEvent.click(getByRole('button', { name: 'Export CSV' }));
    expect(downloadSvg).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadSvg.mock.calls[0][1]).toBe('logical-error-vs-p.svg');
    const [csv, name] = downloadCsv.mock.calls[0];
    expect(name).toBe('logical-error-vs-p.csv');
    expect(csv.split('\n')[0]).toMatch(/rate_low.*units,ci_method,max_likelihood_factor/);
  });

  it('shows an empty state with no campaign results', () => {
    const { getByText } = render(<ThresholdPanel />);
    expect(getByText('No campaign results yet')).toBeTruthy();
  });
});
