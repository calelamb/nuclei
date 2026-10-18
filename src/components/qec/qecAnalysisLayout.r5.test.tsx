// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QecAnalysisView } from './QecAnalysisView';
import { QecCampaignActions } from './QecCampaignActions';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const csv = [3, 5, 7].map((d, i) =>
  `100000,${[1000, 330, 110][i]},0,1,pymatching,s${d},"${JSON.stringify({ d, p: 0.01, r: d }).replace(/"/g, '""')}",`);

beforeEach(() => { useQecCampaignStore.getState().reset(); });
afterEach(() => cleanup());

describe('QecAnalysisView layout (qec-r-58, qec-r-64)', () => {
  it('offers a single way to load a CSV before data exists', () => {
    render(<QecAnalysisView />);
    expect(screen.queryByRole('button', { name: /^Open CSV/ })).toBeNull();
    expect(screen.queryByText('Logical error vs p')).toBeNull();
    expect(screen.getByText('Choose file…')).toBeTruthy();
  });

  it('keeps the plot and the decoder table tall enough to read before the column scrolls', () => {
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...csv].join('\n'), 'd.csv');
    render(<QecAnalysisView />);
    const scroll = screen.getByTestId('qec-analysis-scroll');
    const heights = Array.from(scroll.children)
      .map((child) => parseInt((child as HTMLElement).style.minHeight, 10))
      .filter((h) => Number.isFinite(h));
    expect(heights.length).toBeGreaterThanOrEqual(2);
    heights.forEach((h) => expect(h).toBeGreaterThanOrEqual(320));
  });

  it('reserves room for the plot header, controls and legend so the drawing area is not crushed', () => {
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...csv].join('\n'), 'd.csv');
    render(<QecAnalysisView />);
    const first = screen.getByTestId('qec-analysis-scroll').querySelector<HTMLElement>(':scope > div[style*="min-height"]');
    expect(parseInt(first?.style.minHeight ?? '0', 10)).toBeGreaterThanOrEqual(440);
  });

  it('drops the header Open CSV button from the workbench card before data loads (qec-r-64)', () => {
    render(<QecCampaignActions embedded />);
    expect(screen.queryByRole('button', { name: /^Open CSV/ })).toBeNull();
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...csv].join('\n'), 'd.csv');
    cleanup();
    render(<QecCampaignActions embedded />);
    expect(screen.getByRole('button', { name: /^Open CSV/ })).toBeTruthy();
  });
});
