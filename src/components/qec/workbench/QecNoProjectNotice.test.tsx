// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QecNoProjectNotice } from './QecNoProjectNotice';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { resetQecWorkbenchTestState } from './qecWorkbenchTestUtils';

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const csv = [HEADER, `1000,5,0,1,pymatching,a,"{""d"":3,""p"":0.001}",`].join('\n');

beforeEach(() => { resetQecWorkbenchTestState(); useQecCampaignStore.getState().reset(); });
afterEach(cleanup);

describe('no-project sidebar copy (qec-r-14, qec-r-21)', () => {
  it('points at Analyze instead of promising a drop zone Build does not have', () => {
    render(<QecNoProjectNotice />);
    expect(screen.getByText(/Plot a sinter stats CSV in the Analyze view/)).toBeTruthy();
    expect(screen.getByText(/Studies need a project folder|Open a project folder to create Studies/)).toBeTruthy();
    expect(screen.queryByText(/Drop a sinter stats CSV in the main panel/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Analyze' }));
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
  });

  it('does not repeat the loaded file or its mapping, which the summary bar already shows', () => {
    useQecCampaignStore.getState().loadFromCsv(csv, 'runs.csv');
    useQecWorkbenchStore.setState({ preset: 'analyze' });
    render(<QecNoProjectNotice />);
    expect(screen.queryByText(/runs\.csv/)).toBeNull();
    expect(screen.queryByText(/p = /)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Analyze' })).toBeNull();
  });
});
