// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { QecAnalysisView } from './QecAnalysisView';
import { QecCsvError } from './QecCsvError';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { guessMapping } from '../../types/sinterMapping';

vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const csv = [3, 5].map((d) =>
  `100000,100,0,1,pymatching,s${d},"${JSON.stringify({ d, p: 0.01 }).replace(/"/g, '""')}",`);

beforeEach(() => { useQecCampaignStore.getState().reset(); });
afterEach(() => cleanup());

describe('compact CSV error is dismissible (qec-r-74)', () => {
  it('shows a Dismiss button that clears the store error', () => {
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...csv].join('\n'), 'd.csv');
    useQecCampaignStore.setState({ csvError: 'Not a sinter stats CSV: missing columns' });
    render(<QecAnalysisView />);
    const alert = screen.getByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(useQecCampaignStore.getState().csvError).toBeNull();
    expect(alert.isConnected).toBe(false);
  });

  it('moves focus to the analysis view after Dismiss instead of dropping it on body', () => {
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...csv].join('\n'), 'd.csv');
    useQecCampaignStore.setState({ csvError: 'Not a sinter stats CSV: missing columns' });
    const { container } = render(<QecAnalysisView />);
    const btn = screen.getByRole('button', { name: 'Dismiss' });
    btn.focus();
    fireEvent.click(btn);
    expect(document.activeElement).not.toBe(document.body);
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it('the full (non-compact) notice has no dismiss control', () => {
    render(<QecCsvError id="e" message="Not a sinter stats CSV: x" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('changing the mapping or the units clears a stale error', () => {
    const store = useQecCampaignStore.getState();
    store.loadFromCsv([HEADER, ...csv].join('\n'), 'd.csv');
    useQecCampaignStore.setState({ csvError: 'boom' });
    useQecCampaignStore.getState().setCsvMapping(guessMapping(useQecCampaignStore.getState().csvImport!.rows));
    expect(useQecCampaignStore.getState().csvError).toBeNull();
    useQecCampaignStore.setState({ csvError: 'boom' });
    useQecCampaignStore.getState().setRequestedUnits('per_shot');
    expect(useQecCampaignStore.getState().csvError).toBeNull();
  });
});
