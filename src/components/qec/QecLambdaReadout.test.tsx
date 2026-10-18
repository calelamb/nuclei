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
