// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QecAnalysisView } from './QecAnalysisView';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

const platform = vi.hoisted(() => ({ web: true }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => platform.web }));

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const csv = [3, 5, 7].map((d, i) =>
  `100000,${[1000, 330, 110][i]},0,1,pymatching,s${d},"${JSON.stringify({ d, p: 0.01, r: d }).replace(/"/g, '""')}",`);

beforeEach(() => { platform.web = true; useQecCampaignStore.getState().reset(); });
afterEach(() => cleanup());

describe('web QEC Workbench page header (design-r8-02)', () => {
  it('titles the page with an h1 and the shared pane header even before any data', () => {
    const { container } = render(<QecAnalysisView />);
    expect(screen.getByRole('heading', { level: 1, name: 'QEC Workbench' })).toBeTruthy();
    expect(container.querySelector('.nuclei-pane-header')).toBeTruthy();
    // Still one way in: no header Open CSV button next to the empty state's drop zone.
    expect(screen.queryByRole('button', { name: /^Open CSV/ })).toBeNull();
  });

  it('top-aligns the empty state under the header', () => {
    const { container } = render(<QecAnalysisView />);
    expect(container.querySelector('.qec-empty--top')).toBeTruthy();
    expect(container.querySelector('.qec-empty--center')).toBeNull();
  });

  it('names the loaded file and renders panel titles as h2 headings', () => {
    useQecCampaignStore.getState().loadFromCsv([HEADER, ...csv].join('\n'), 'd.csv');
    const { container } = render(<QecAnalysisView />);
    expect(screen.getByRole('heading', { level: 1, name: 'QEC Workbench' })).toBeTruthy();
    expect(container.querySelector('.nuclei-pane-header')?.textContent).toContain('d.csv');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain('Logical error vs p');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain('Decoder Workbench');
  });

  it('caps the analysis body so tables stop running edge to edge', () => {
    const { container } = render(<QecAnalysisView />);
    expect(container.querySelector('.qec-web-body')).toBeTruthy();
  });

  it('keeps the desktop analysis view free of the web page header', () => {
    platform.web = false;
    const { container } = render(<QecAnalysisView />);
    expect(screen.queryByRole('heading', { level: 1, name: 'QEC Workbench' })).toBeNull();
    expect(container.querySelector('.qec-web-body')).toBeNull();
  });
});
