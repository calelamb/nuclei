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
  it('shows one row per (decoder, d, p) with kept-shot LER, never pooled, and exports CSV', () => {
    loadCampaign();
    const { getAllByText, getByText, getByRole, container } = render(<DecoderWorkbench />);
    expect(getAllByText('pymatching').length).toBeGreaterThan(1);
    expect(getAllByText('fusion_blossom').length).toBeGreaterThan(1);
    // 2 decoders x 2 distances x 2 noise = 8 points, none pooled.
    expect(container.querySelectorAll('tbody tr').length).toBe(8);
    expect(getByText(/likelihood-ratio/)).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Export decoder table (CSV)' }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const csv = downloadCsv.mock.calls[0][0] as string;
    expect(csv).toContain('decoder,experiment,distance,noise,shots,discards,kept_shots,errors,logical_error_rate');
    expect(csv.trim().split('\n')).toHaveLength(9);
  });

  it('rates are errors / (shots - discards): 10 errors in 1000 shots with 900 discarded is 0.1', () => {
    useQecCampaignStore.setState({
      rowsByStrongId: {
        a: { shots: 1000, errors: 10, discards: 900, seconds: 1, decoder: 'pymatching', strong_id: 'a',
          json_metadata: { d: 3, p: 0.01 }, custom_counts: {} },
      },
    });
    const { container, getByText } = render(<DecoderWorkbench />);
    expect(container.querySelector('tbody')!.textContent).toContain('0.100 [0.0242, 0.246]');
    expect(getByText('900')).toBeTruthy();
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
    const { getAllByText, getByText, getByRole, container } = render(<ThresholdPanel />);
    expect(getAllByText('95% CI').length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-label="Error suppression factor Λ"]')!.textContent).toMatch(/\d\.\d+–\d/);
    // Rounds are known, so the default is the per-cycle definition of Λ.
    expect(getByText('logical error per round')).toBeTruthy();
    expect(getByRole('radio', { name: 'Per round' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(getByRole('radio', { name: 'Per shot' }));
    expect(getByText('logical error per shot')).toBeTruthy();
  });

  it('exported Λ text states its units and warns when per-shot rounds vary with d', () => {
    const rows = parseSinterCsv(syntheticCsv);
    const map: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) map[r.strong_id] = r;
    useQecCampaignStore.setState({ rowsByStrongId: map, statsCsv: syntheticCsv, running: false });
    const { getByRole } = render(<ThresholdPanel />);
    const svgText = () => {
      fireEvent.click(getByRole('button', { name: 'Export plot as SVG' }));
      return (downloadSvg.mock.calls.at(-1)![0] as SVGSVGElement).querySelector('desc')!.textContent!;
    };
    expect(svgText()).toMatch(/Λ = [^,]*,[^Λ]*per round/);
    expect(svgText()).not.toMatch(/rounds vary with d/);
    fireEvent.click(getByRole('radio', { name: 'Per shot' }));
    expect(svgText()).toMatch(/Λ = [^,]*,[^Λ]*per shot/);
    expect(svgText()).toMatch(/rounds vary with d/);
  });

  it('synthetic data: separate non-zigzag curves, Λ per experiment from 3 points, Λ in the SVG', () => {
    const rows = parseSinterCsv(syntheticCsv);
    const map: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) map[r.strong_id] = r;
    useQecCampaignStore.setState({ rowsByStrongId: map, statsCsv: syntheticCsv, running: false });
    const { container, getByRole } = render(<ThresholdPanel />);
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
    fireEvent.click(getByRole('button', { name: 'Export plot as SVG' }));
    expect((downloadSvg.mock.calls.at(-1)![0] as SVGSVGElement).querySelector('desc')!.textContent).toMatch(/Λ = .* synth r=d|synth r=d.*Λ = /);
    expect(container.textContent).toMatch(/rounds = 3d/);
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
    fireEvent.click(getByRole('button', { name: 'Export plot as SVG' }));
    fireEvent.click(getByRole('button', { name: 'Export plot data (CSV)' }));
    expect(downloadSvg).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadSvg.mock.calls[0][1]).toBe('logical-error-vs-p.svg');
    const [csv, name] = downloadCsv.mock.calls[0];
    expect(name).toBe('logical-error-vs-p.csv');
    expect(csv.split('\n')[0]).toMatch(/rate_low.*units,ci_method,max_likelihood_factor/);
  });

  it('exports a self-contained SVG: legend, background, fixed size, no viewport scaling', () => {
    loadCampaign();
    const { getByRole } = render(<ThresholdPanel />);
    fireEvent.click(getByRole('button', { name: 'Export plot as SVG' }));
    const exported = downloadSvg.mock.calls[0][0] as SVGSVGElement;
    expect(exported.getAttribute('width')).toMatch(/^\d+$/);
    expect(exported.getAttribute('height')).toMatch(/^\d+$/);
    expect(exported.getAttribute('style') ?? '').not.toMatch(/100%/);
    const legend = exported.querySelector('[data-testid="qec-svg-legend"]')!;
    expect(legend).toBeTruthy();
    expect(legend.textContent).toContain('pymatching');
    expect(legend.textContent).toContain('fusion_blossom');
    expect(legend.textContent).toMatch(/Distance.*d = 3.*d = 5/);
    const bg = exported.querySelector('rect[data-export-bg]')!;
    expect(bg).toBeTruthy();
    expect(bg.getAttribute('fill')).toBeTruthy();
  });

  it('shows an empty state with no campaign results', () => {
    const { getByText } = render(<ThresholdPanel />);
    expect(getByText('No campaign results yet')).toBeTruthy();
  });
});
