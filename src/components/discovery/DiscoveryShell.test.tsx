// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { DiscoverySidebar } from './DiscoverySidebar';
import { DiscoveryWorkbench } from './DiscoveryWorkbench';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useProjectStore } from '../../stores/projectStore';
import { FIXTURE_DEFINITION_FILE, fixtureDefinition, fixtureRun } from '../../services/discovery/fixtures';
import { PROJECT_ROOT, renderOn, resetDiscoveryTestState, seedPopulated, spyOnActions } from './testUtils';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => null,
  default: () => null,
  loader: { config: () => undefined },
}));

beforeEach(() => {
  resetDiscoveryTestState();
});
afterEach(() => cleanup());

describe('DiscoverySidebar', () => {
  it('web build: shows the desktop-kernel state and disables New discovery', () => {
    renderOn(<DiscoverySidebar />, 'web');
    expect(screen.getByText('Needs the desktop kernel')).toBeTruthy();
    expect((screen.getByRole('button', { name: /New discovery/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('no project: asks to open one', () => {
    renderOn(<DiscoverySidebar />);
    expect(screen.getByText('Open a project')).toBeTruthy();
  });

  it('loading: shows skeletons, not a blank box', () => {
    useProjectStore.setState({ projectRoot: PROJECT_ROOT });
    useDiscoveryStore.setState({ projectRoot: PROJECT_ROOT, loading: true });
    renderOn(<DiscoverySidebar />);
    expect(screen.getByLabelText('Loading discovery definitions').getAttribute('aria-busy')).toBe('true');
  });

  it('empty: offers New discovery that opens the wizard', () => {
    useProjectStore.setState({ projectRoot: PROJECT_ROOT });
    useDiscoveryStore.setState({ projectRoot: PROJECT_ROOT });
    renderOn(<DiscoverySidebar />);
    expect(screen.getByText('No discovery definitions yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /New discovery/ })[0]);
    expect(useDiscoveryStore.getState().wizardOpen).toBe(true);
  });

  it('populated: lists definitions with status pills, marks stale runs and selects runs', () => {
    seedPopulated({ select: 'none' });
    const stale = fixtureRun({ run_id: '20261019-090000-ffff', status: 'stale' });
    useDiscoveryStore.setState((s) => ({ runsByDefinition: { [FIXTURE_DEFINITION_FILE]: [stale, ...s.runsByDefinition[FIXTURE_DEFINITION_FILE]] } }));
    const select = vi.fn(async () => undefined);
    useDiscoveryStore.setState({ selectRun: select });
    renderOn(<DiscoverySidebar />);
    const list = screen.getByRole('list', { name: 'Discovery definitions' });
    expect(within(list).getByText('w-state-synthesis')).toBeTruthy();
    expect(within(list).getByText('Stale')).toBeTruthy();
    expect(within(list).getByText('Completed')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: /Run 2026-10-19 09:00, stale/ }));
    expect(select).toHaveBeenCalledWith('20261019-090000-ffff');
  });

  it('shows validation errors inline', () => {
    seedPopulated({ select: 'none' });
    useDiscoveryStore.setState({ validationErrors: [{ fileName: 'broken.discovery.yaml', path: '/proj/experiments/broken.discovery.yaml', errors: ['budget.max_evaluations: must be at least 1'] }] });
    renderOn(<DiscoverySidebar />);
    expect(screen.getByText('broken.discovery.yaml')).toBeTruthy();
    expect(screen.getByText('budget.max_evaluations: must be at least 1')).toBeTruthy();
  });

  it('selecting a definition calls selectDefinition', () => {
    seedPopulated({ select: 'none' });
    const spies = spyOnActions(['selectDefinition']);
    renderOn(<DiscoverySidebar />);
    fireEvent.click(screen.getByRole('button', { name: /w-state-synthesis/ }));
    expect(spies.selectDefinition).toHaveBeenCalledWith(FIXTURE_DEFINITION_FILE);
  });
});

describe('DiscoveryWorkbench', () => {
  it('web build: friendly desktop-kernel state', () => {
    renderOn(<DiscoveryWorkbench />, 'web');
    expect(screen.getByText('The Discovery Engine needs the desktop kernel')).toBeTruthy();
  });

  it('no project: asks to open one', () => {
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByText('Open a project to use the Discovery Engine')).toBeTruthy();
  });

  it('project with nothing selected and no definitions: invites a first discovery', () => {
    useProjectStore.setState({ projectRoot: PROJECT_ROOT });
    useDiscoveryStore.setState({ projectRoot: PROJECT_ROOT });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByText('Evolve a better quantum program')).toBeTruthy();
  });

  it('loading a run from disk shows skeletons', () => {
    seedPopulated();
    useDiscoveryStore.setState({ views: {}, kpis: {} });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByLabelText('Loading run').getAttribute('aria-busy')).toBe('true');
  });

  it('shows the store error as an alert above the content', () => {
    seedPopulated({ error: 'Run c-1 could not be read from disk.' });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByRole('alert').textContent).toContain('could not be read from disk');
  });

  it('populated run: header, KPI strip and tabs render', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByRole('region', { name: 'Run header' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Run KPIs' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\d+$/, ''))).toEqual(['Overview', 'Lineage', 'Archive', 'Candidates', 'Guardrails', 'Conjectures']);
  });

  it('definition without a run: shows settings and starts a run', () => {
    seedPopulated({ select: 'definition' });
    const spies = spyOnActions(['startRun']);
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByText(/Islands × generations/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    expect(spies.startRun).toHaveBeenCalledWith(FIXTURE_DEFINITION_FILE);
  });

  it('Frontier definition shows the open question and the honesty text', () => {
    seedPopulated({ select: 'definition' });
    useDiscoveryStore.setState({
      definitions: [{ ...fixtureDefinition({ evaluator: { kind: 'trainability_frontier', config: {} }, search: { archive: { descriptors: ['log2_dla_dimension', 'two_qubit_gates_per_layer'] } } }) }],
    });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByText(/Is every trainable ansatz classically simulable\?/)).toBeTruthy();
    expect(screen.getByText(/It is not a proof of classical hardness/)).toBeTruthy();
  });

  it('disables Start while another run is live', () => {
    seedPopulated({ select: 'definition', liveRunIds: ['other'] });
    renderOn(<DiscoveryWorkbench />);
    expect((screen.getByRole('button', { name: /Start run/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('wizard replaces the main area', () => {
    seedPopulated({ wizardOpen: true });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByRole('form', { name: 'New discovery' })).toBeTruthy();
  });
});
