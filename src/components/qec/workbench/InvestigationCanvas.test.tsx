// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InvestigationCanvas } from './InvestigationCanvas';
import { circuitHint } from './circuitHint';
import { orderCanvasPanels } from './orderCanvasPanels';
import { resolveQecPanels } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';

afterEach(() => cleanup());
beforeEach(() => useQecCampaignStore.getState().reset());

describe('canvas instrument order (qec-07)', () => {
  it('puts the Analyze preset\'s own instrument first', () => {
    const panels = resolveQecPanels('analyze', 'canvas', []);
    expect(panels[0].id).not.toBe('campaign-center');
    expect(orderCanvasPanels('analyze', panels)[0].id).toBe('campaign-center');
  });

  it('leaves the other presets alone', () => {
    const panels = resolveQecPanels('build', 'canvas', []);
    expect(orderCanvasPanels('build', panels)).toEqual(panels);
  });

  it('renders Campaign Center as the first instrument in Analyze with a route to CSV import', () => {
    useQecWorkbenchStore.setState({ preset: 'analyze' });
    const noop = () => undefined;
    render(<InvestigationCanvas inspectorOpen onToggleInspector={noop} toggleRef={{ current: null }} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Campaign Center');
    expect(screen.getByText('Choose file…')).toBeTruthy(); // the drop zone is the single way in
  });
});

describe('instrument headers (rq-r3-17)', () => {
  it.each(['build', 'analyze', 'observe'] as const)('gives every %s instrument the same help and pin pair', (preset) => {
    useQecWorkbenchStore.setState({ preset });
    const noop = () => undefined;
    const { container } = render(<InvestigationCanvas inspectorOpen onToggleInspector={noop} toggleRef={{ current: null }} />);
    const headers = Array.from(container.querySelectorAll('.qec-instrument > header'));
    expect(headers.length).toBeGreaterThan(1);
    for (const header of headers) {
      expect(header.querySelector('a[aria-label$="docs (opens in new tab)"]')).not.toBeNull();
      expect(header.querySelector('button[aria-pressed]')).not.toBeNull();
    }
  });

  it('marks only circuit instruments so the open hint appears once, in the first empty circuit card', () => {
    useQecWorkbenchStore.setState({ preset: 'build', pinnedPanelIds: ['stream-health'] });
    const noop = () => undefined;
    const { container } = render(<InvestigationCanvas inspectorOpen onToggleInspector={noop} toggleRef={{ current: null }} />);
    const marked = Array.from(container.querySelectorAll('.qec-instrument[data-circuit]')).map((el) => (el as HTMLElement).dataset.panel);
    expect(marked.length).toBeGreaterThan(0);
    for (const id of marked) expect(['timeline', 'lattice', 'detector-graph']).toContain(id);
    expect(container.querySelector('.qec-instrument[data-panel="stream-health"][data-circuit]')).toBeNull();
  });
});

describe('canvas grid rows', () => {
  it('leaves auto-row sizing to the stylesheet so the stacked container query can override it', () => {
    useQecWorkbenchStore.setState({ preset: 'analyze' });
    const noop = () => undefined;
    const { container } = render(<InvestigationCanvas inspectorOpen onToggleInspector={noop} toggleRef={{ current: null }} />);
    const grid = container.querySelector('.qec-investigation__panels') as HTMLElement;
    expect(grid.style.gridAutoRows).toBe('');
  });
});

describe('empty circuit hint (qec-r-32)', () => {
  const base = { projectOpen: true, studyCount: 0, hasActiveStudy: false, circuitCount: 0 };

  it('asks for a project folder before anything else when none is open', () => {
    expect(circuitHint({ ...base, projectOpen: false })).toBe('Open a project folder to load circuits.');
    expect(circuitHint({ ...base, projectOpen: false, studyCount: 3 })).toBe('Open a project folder to load circuits.');
  });

  it('asks to choose a Study when Studies exist but none is active', () => {
    expect(circuitHint({ ...base, studyCount: 2 })).toBe('Choose a Study to see its circuit.');
  });

  it('asks to create a Study only when there are none', () => {
    expect(circuitHint(base)).toBe('Create a Study to attach a .stim circuit.');
  });

  it('describes the active Study once one is chosen', () => {
    expect(circuitHint({ ...base, studyCount: 1, hasActiveStudy: true, circuitCount: 0 })).toBe('This Study references no .stim circuit.');
    expect(circuitHint({ ...base, studyCount: 1, hasActiveStudy: true, circuitCount: 2 })).toBe('Double-click a .stim file under Referenced files to open it.');
  });

  it('renders the no-project hint on the canvas and never claims a Study references nothing', () => {
    useQecWorkbenchStore.setState({ preset: 'build' });
    const noop = () => undefined;
    render(<InvestigationCanvas inspectorOpen onToggleInspector={noop} toggleRef={{ current: null }} />);
    expect(screen.queryAllByText('This Study references no .stim circuit.')).toHaveLength(0);
    expect(screen.getAllByText('Open a project folder to load circuits.').length).toBeGreaterThan(0);
  });
});

describe('selection promises (qec-r-26)', () => {
  it('does not claim selections are linked across instruments', () => {
    useQecWorkbenchStore.setState({ preset: 'build' });
    const noop = () => undefined;
    render(<InvestigationCanvas inspectorOpen onToggleInspector={noop} toggleRef={{ current: null }} />);
    expect(screen.queryByText('Selections linked')).toBeNull();
  });
});
