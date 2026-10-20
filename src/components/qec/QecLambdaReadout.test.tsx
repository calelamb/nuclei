// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QecLambdaReadout } from './QecLambdaReadout';
import { lambdaEstimates } from '../../lib/qecFit';
import { useThemeStore } from '../../stores/themeStore';
import type { QecCampaignStatsRow } from '../../types/qec';

function row(d: number, p: number, rate: number): QecCampaignStatsRow {
  const shots = 1_000_000;
  return {
    strong_id: `${d}-${p}`, decoder: 'pymatching', shots, errors: Math.max(1, Math.round(rate * shots)), discards: 0,
    seconds: 1, custom_counts: {}, json_metadata: { d, p, r: d },
  };
}

// Twelve well-behaved p values, each with a clean suppression ladder.
const rows = Array.from({ length: 12 }, (_, i) => 0.0002 + i * 0.00008).flatMap((p) =>
  [3, 5, 7, 9].map((d, k) => row(d, p, 0.01 / 3 ** k)));

describe('QecLambdaReadout length (qec-r-35)', () => {
  afterEach(cleanup);

  it('shows eight rows with a range summary and expands on request', () => {
    const estimates = lambdaEstimates(rows, { units: 'per_round' });
    const colors = useThemeStore.getState().colors;
    const { container } = render(<QecLambdaReadout decoders={['pymatching']} estimates={estimates} units="per_round" colors={colors} />);
    const body = () => container.querySelectorAll('table.qec-lambda-table tbody tr').length;
    const meaningful = estimates.filter((e) => e.estimate.intervalMeaningful).length;
    expect(meaningful).toBeGreaterThan(8);
    expect(body()).toBe(8);
    expect(screen.getByText(/^Λ .+ over \d+ values of p$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Show all ${meaningful}` }));
    expect(body()).toBe(meaningful);
  });
});

describe('QecLambdaReadout experiment groups (qec-r-79)', () => {
  afterEach(cleanup);
  const labelled = (label: string) => rows.slice(0, 16).map((r) => ({ ...r, strong_id: `${label}-${r.strong_id}`, json_metadata: { ...r.json_metadata, label } }));

  it('renders one group row per experiment, none for a single experiment', () => {
    const colors = useThemeStore.getState().colors;
    const two = lambdaEstimates([...labelled('a'), ...labelled('b')], { units: 'per_round' });
    const { container, unmount } = render(<QecLambdaReadout decoders={['pymatching']} estimates={two} units="per_round" colors={colors} />);
    expect(container.querySelectorAll('tr.qec-lambda-group').length).toBe(2);
    unmount();
    const one = lambdaEstimates(labelled('a'), { units: 'per_round' });
    const r2 = render(<QecLambdaReadout decoders={['pymatching']} estimates={one} units="per_round" colors={colors} />);
    expect(r2.container.querySelectorAll('tr.qec-lambda-group').length).toBe(0);
  });
});

describe('QecLambdaReadout warnings (qec-r-55)', () => {
  afterEach(cleanup);
  it('exposes a row warning as a focusable button, not a title-only span', () => {
    const colors = useThemeStore.getState().colors;
    const saturated = [3, 5, 7].map((d) => row(d, 0.01, 0.5));
    const estimates = lambdaEstimates([...[3, 5, 7].map((d, k) => row(d, 0.001, 0.01 / 3 ** k)), ...saturated], { units: 'per_round' });
    const { container } = render(<QecLambdaReadout decoders={['pymatching']} estimates={estimates} units="per_round" colors={colors} />);
    const warn = container.querySelector('button[aria-label^="Warnings:"]');
    expect(warn).not.toBeNull();
    expect(warn?.getAttribute('title')).toBeNull();
    expect(container.querySelector('[role="img"][title]')).toBeNull();
  });
});

describe('QecLambdaReadout without a fit (qec-r-84)', () => {
  afterEach(cleanup);

  it('explains which distances were dropped instead of repeating the generic rule', () => {
    const colors = useThemeStore.getState().colors;
    const zero = (d: number): QecCampaignStatsRow => ({ ...row(d, 0.001, 0.01), errors: 0 });
    const data = [row(3, 0.001, 0.01), row(5, 0.001, 0.001), zero(7), zero(9), zero(11)];
    const estimates = lambdaEstimates(data, { units: 'per_shot' });
    const { container } = render(<QecLambdaReadout decoders={['pymatching']} estimates={estimates} rows={data} units="per_shot" colors={colors} />);
    expect(container.textContent).toContain('only d = 3 and 5 have logical errors at a shared p (d = 7, 9 and 11 had none)');
    expect(container.textContent).not.toContain('needs ≥ 3 distances');
  });

  it('titles the panel in the primary text colour', () => {
    const colors = useThemeStore.getState().colors;
    render(<QecLambdaReadout decoders={[]} estimates={[]} units="per_shot" colors={colors} />);
    expect(screen.getByRole('heading', { name: 'Error suppression Λ' }).style.color).not.toBe('');
  });
});
