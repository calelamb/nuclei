// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DecoderWorkbench } from './DecoderWorkbench';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import type { QecCampaignStatsRow } from '../../types/qec';

function row(id: string, d: number, extra: Record<string, unknown> = {}, seconds = 0.12): QecCampaignStatsRow {
  return {
    shots: 10000, errors: 100, discards: 0, seconds, decoder: 'pymatching', strong_id: id,
    json_metadata: { d, r: d, p: 0.01, label: 'stats', b: 'X', ...extra }, custom_counts: {},
  };
}

function load(rows: QecCampaignStatsRow[]): void {
  useQecCampaignStore.setState({ rowsByStrongId: Object.fromEntries(rows.map((r) => [r.strong_id, r])) });
}

beforeEach(() => useQecCampaignStore.getState().reset());
afterEach(() => cleanup());

describe('DecoderWorkbench polish', () => {
  it('empty state mentions dropping a sinter CSV', () => {
    const { container } = render(<DecoderWorkbench />);
    expect(container.textContent).toMatch(/drop a sinter .*CSV/i);
  });

  it('hides the Experiment column when constant and states the context once', () => {
    load([row('a', 3), row('b', 5)]);
    const { container, queryByText } = render(<DecoderWorkbench />);
    expect(queryByText('Experiment')).toBeNull();
    expect(container.textContent).toContain('Experiment: rounds = d · b=X');
    expect(container.textContent).not.toContain('stats r=d');
  });

  it('shows the distinguishing metadata per row when experiments differ', () => {
    load([row('a', 3, { b: 'X' }), row('b', 3, { b: 'Z' })]);
    const { getByText, container } = render(<DecoderWorkbench />);
    expect(getByText('Experiment')).toBeTruthy();
    const cells = [...container.querySelectorAll('tbody tr td:nth-child(2)')].map((c) => c.textContent);
    expect(cells).toEqual(['rounds = d · b=X', 'rounds = d · b=Z']);
  });

  it('formats seconds per shot with units', () => {
    load([row('a', 3, {}, 0.12)]);
    const { container } = render(<DecoderWorkbench />);
    expect(container.querySelector('tbody')!.textContent).toContain('12 µs');
    expect(container.querySelector('tbody')!.textContent).not.toContain('0.0000120');
  });

  it('omits the Experiment sentence when only the default import label remains', () => {
    load([{ ...row('a', 3), json_metadata: { d: 3, p: 0.01, label: 'stats' } }]);
    const { container } = render(<DecoderWorkbench />);
    expect(container.textContent).not.toContain('Experiment:');
  });

  it('describes seconds as CPU core time, not wall-clock', () => {
    load([row('a', 3)]);
    const { container } = render(<DecoderWorkbench />);
    const title = container.querySelector('th[title*="seconds"]')!.getAttribute('title')!;
    expect(title).toMatch(/CPU core/i);
    expect(title).not.toMatch(/wall-clock/i);
  });
});

describe('DecoderWorkbench web empty state', () => {
  it('does not tell web users to run a campaign', async () => {
    vi.resetModules();
    vi.doMock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));
    const { DecoderWorkbench: Web } = await import('./DecoderWorkbench');
    const { container } = render(<Web />);
    expect(container.textContent).not.toMatch(/run a qec campaign/i);
    expect(container.textContent).toMatch(/drop a sinter stats csv/i);
    vi.doUnmock('../../platform/buildTarget');
  });
});
