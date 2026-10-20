// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as buildTarget from '../../../platform/buildTarget';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QecNoProjectNotice } from './QecNoProjectNotice';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { PlatformProvider } from '../../../platform/PlatformProvider';
import type { PlatformBridge } from '../../../platform/bridge';
import { resetQecWorkbenchTestState } from './qecWorkbenchTestUtils';

const desktop = { getPlatform: () => 'desktop' } as unknown as PlatformBridge;
const renderDesktop = () => render(<PlatformProvider bridge={desktop}><QecNoProjectNotice /></PlatformProvider>);

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const csv = [HEADER, `1000,5,0,1,pymatching,a,"{""d"":3,""p"":0.001}",`].join('\n');

beforeEach(() => { resetQecWorkbenchTestState(); useQecCampaignStore.getState().reset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('no-project sidebar copy (qec-r-14, qec-r-21)', () => {
  it('on the web the main panel owns the drop-CSV line, so the side note says it once and offers no preset switch', () => {
    vi.spyOn(buildTarget, 'isWebBuild').mockReturnValue(true);
    const web = { getPlatform: () => 'web' } as unknown as PlatformBridge;
    render(<PlatformProvider bridge={web}><QecNoProjectNotice /></PlatformProvider>);
    expect(screen.queryByText(/Drop a sinter stats CSV/)).toBeNull();
    expect(screen.getAllByText(/sinter stats CSV/i)).toHaveLength(1);
    expect(screen.getByText(/Studies need a project folder/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Analyze' })).toBeNull();
  });

  it('on desktop points at Analyze instead of promising a drop zone Build does not have', () => {
    renderDesktop();
    expect(screen.getByText(/Plot a sinter stats CSV in the Analyze view/)).toBeTruthy();
    expect(screen.getByText(/Studies need a project folder|Open a project folder to create Studies/)).toBeTruthy();
    expect(screen.queryByText(/Drop a sinter stats CSV in the main panel/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Analyze' }));
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
  });

  it('does not repeat the loaded file or its mapping, which the summary bar already shows', () => {
    useQecCampaignStore.getState().loadFromCsv(csv, 'runs.csv');
    useQecWorkbenchStore.setState({ preset: 'analyze' });
    renderDesktop();
    expect(screen.queryByText(/runs\.csv/)).toBeNull();
    expect(screen.queryByText(/p = /)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Analyze' })).toBeNull();
  });
});
