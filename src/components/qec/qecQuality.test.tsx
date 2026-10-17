// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QecAnalysisView } from './QecAnalysisView';
import { ThresholdPanel } from './ThresholdPanel';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const line = (id: string, meta: Record<string, unknown>, errors = 10) =>
  `100000,${errors},0,1,pymatching,${id},"${JSON.stringify(meta).replace(/"/g, '""')}",`;
const csv = [HEADER, ...[3, 5, 7].flatMap((d) => [0.001, 0.002, 0.004].map((p, i) => line(`${d}-${i}`, { d, p, r: d }, 100 / d)))].join('\n');

beforeEach(() => useQecCampaignStore.getState().reset());
afterEach(() => cleanup());

describe('Campaign Center chrome', () => {
  it('does not repeat "Campaign" under the Campaign Center heading when nothing is loaded', () => {
    const { queryAllByText } = render(<QecAnalysisView embedded />);
    expect(queryAllByText('Campaign')).toHaveLength(0);
  });

  it('names the loaded file once (in the mapping summary), not again in a title bar', () => {
    useQecCampaignStore.getState().loadFromCsv(csv, 'realistic.csv');
    const { getAllByText } = render(<QecAnalysisView embedded />);
    expect(getAllByText('realistic.csv')).toHaveLength(1);
  });

  it('uses a plot title short enough to survive a narrow card', () => {
    useQecCampaignStore.getState().loadFromCsv(csv, 'realistic.csv');
    const { getByText } = render(<ThresholdPanel />);
    expect(getByText('Logical error vs p')).toBeTruthy();
  });
});

describe('Edit mapping does not squeeze the plot', () => {
  it('lives inside the scrolling analysis area, so opening it adds scroll instead of taking height from the plot', () => {
    useQecCampaignStore.getState().loadFromCsv(csv, 'realistic.csv');
    const { getByLabelText, getByRole, container } = render(<QecAnalysisView embedded />);
    const scroller = container.querySelector('[data-testid="qec-analysis-scroll"]') as HTMLElement;
    expect(scroller).toBeTruthy();
    expect(scroller.contains(getByLabelText('CSV column mapping'))).toBe(true);
    fireEvent.click(getByRole('button', { name: /Edit mapping/ }));
    const section = getByLabelText('CSV column mapping');
    expect(section.style.maxHeight).toBe('');
    expect(scroller.contains(getByRole('group', { name: /Plot points/ }))).toBe(true);
  });
});
