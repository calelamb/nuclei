// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ThresholdPanel } from './ThresholdPanel';
import { QEC_PLOT_CSV_DOCS } from '../../config/docsLinks';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

beforeEach(() => useQecCampaignStore.getState().reset());
afterEach(() => cleanup());

describe('ThresholdPanel empty state docs link', () => {
  it('points "Read the docs" at the Plot a sinter CSV how-to', () => {
    const { getByText } = render(<ThresholdPanel />);
    const link = getByText('Read the docs →') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(QEC_PLOT_CSV_DOCS);
    expect(QEC_PLOT_CSV_DOCS).toMatch(/\/docs\/research\/plot-a-sinter-csv\/$/);
  });
});
