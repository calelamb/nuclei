// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ExperimentsPanel } from './ExperimentsPanel';
import { useExperimentStore } from '../../services/experimentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import type { ExperimentSpec } from '../../types/experiment';

const SECOND_SPEC: ExperimentSpec = {
  schema: 1,
  name: 'depth-grid',
  entry: 'bell.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 2048,
  seed: 7,
  sweep: { depth: { values: [1, 2] } },
};

const FIXTURE_SPEC: ExperimentSpec = {
  schema: 1,
  name: 'theta-sweep',
  entry: 'run.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 100,
  seed: 42,
  sweep: { theta: { values: [0, 1, 2] } },
};

/** Mocks the store's I/O actions (reload/scanRuns/watch) so the fixture data
 * we `setState` directly is never clobbered by a real Tauri fs call — the
 * component under test only reads state + calls actions, so this is enough
 * to exercise it without touching `@tauri-apps/*`. */
function installFixtureStore() {
  useExperimentStore.setState({
    loading: false,
    experiments: [
      { fileName: 'theta-sweep.experiment.yaml', path: '/proj/experiments/theta-sweep.experiment.yaml', spec: FIXTURE_SPEC },
      { fileName: 'depth-grid.experiment.yaml', path: '/proj/experiments/depth-grid.experiment.yaml', spec: SECOND_SPEC },
    ],
    validationErrors: [
      { fileName: 'broken.experiment.yaml', path: '/proj/experiments/broken.experiment.yaml', errors: ['shots: Invalid input: expected number, received string'] },
    ],
    runsByExperiment: {},
    reload: vi.fn(async () => {}),
    scanRuns: vi.fn(async () => {}),
    startWatching: vi.fn(async () => {}),
    stopWatching: vi.fn(),
  });
}

describe('ExperimentsPanel', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectRoot: '/proj', tabs: [], activeTabPath: null });
    useExperimentUiStore.setState({ selectedExperimentFileName: null, selectedRunDir: null });
    useExperimentRunStore.setState({ active: null, lastSummary: null, lastError: null });
    installFixtureStore();
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
  });

  it('shows a friendly empty state when no project is open', () => {
    useProjectStore.setState({ projectRoot: null });
    const { getByText } = render(<ExperimentsPanel />);
    expect(getByText(/open a folder to start experimenting/i)).toBeTruthy();
  });

  it('renders discovered experiments with name, entry, backend, and grid size', () => {
    const { getByText, getAllByText } = render(<ExperimentsPanel />);
    expect(getByText('theta-sweep')).toBeTruthy();
    expect(getByText(/run\.py/)).toBeTruthy();
    expect(getAllByText(/simulator\/statevector/).length).toBeGreaterThan(0);
    expect(getByText(/3 points/)).toBeTruthy();
  });

  it('renders malformed experiments as a validation-error card, not a crash', () => {
    const { getByRole, getAllByRole, queryByText } = render(<ExperimentsPanel />);
    const alerts = getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('broken.experiment.yaml');
    expect(alerts[0].textContent).toMatch(/\d+ problems?/);
    fireEvent.click(getByRole('button', { name: /broken.experiment.yaml/ }));
    expect(queryByText(/Invalid input/)).toBeNull();
  });

  it('clicking an experiment row selects it in the UI store', () => {
    const { getByText } = render(<ExperimentsPanel />);
    fireEvent.click(getByText('theta-sweep'));
    expect(useExperimentUiStore.getState().selectedExperimentFileName).toBe('theta-sweep.experiment.yaml');
  });

  it('reloads and starts watching the project on mount', () => {
    render(<ExperimentsPanel />);
    const state = useExperimentStore.getState();
    expect(state.reload).toHaveBeenCalledWith('/proj', expect.anything());
    expect(state.startWatching).toHaveBeenCalledWith('/proj', expect.anything());
  });

  it('editing experiment B after A loads B into the form (research-01)', () => {
    const { getByLabelText, container } = render(<ExperimentsPanel />);
    fireEvent.click(getByLabelText('Edit theta-sweep'));
    expect((container.querySelector('#exp-name') as HTMLInputElement).value).toBe('theta-sweep');
    fireEvent.click(getByLabelText('Edit depth-grid'));
    expect((container.querySelector('#exp-name') as HTMLInputElement).value).toBe('depth-grid');
    expect((container.querySelector('#exp-entry') as HTMLInputElement).value).toBe('bell.py');
    expect((container.querySelector('#exp-shots') as HTMLInputElement).value).toBe('2048');
  });

  it('asks before discarding dirty edits when switching to another experiment (research-01)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { getByLabelText, container } = render(<ExperimentsPanel />);
    fireEvent.click(getByLabelText('Edit theta-sweep'));
    fireEvent.change(container.querySelector('#exp-shots') as HTMLInputElement, { target: { value: '555' } });
    fireEvent.click(getByLabelText('Edit depth-grid'));
    expect(confirmSpy).toHaveBeenCalled();
    expect((container.querySelector('#exp-name') as HTMLInputElement).value).toBe('theta-sweep');
    confirmSpy.mockReturnValue(true);
    fireEvent.click(getByLabelText('Edit depth-grid'));
    expect((container.querySelector('#exp-name') as HTMLInputElement).value).toBe('depth-grid');
    confirmSpy.mockRestore();
  });

  it('"New experiment" while editing switches to a blank form instead of closing (research-17)', () => {
    const { getByLabelText, getByText, container } = render(<ExperimentsPanel />);
    fireEvent.click(getByLabelText('Edit theta-sweep'));
    fireEvent.click(getByText('New experiment', { selector: 'button' }));
    const name = container.querySelector('#exp-name') as HTMLInputElement;
    expect(name).toBeTruthy();
    expect(name.value).toBe('');
  });

  it('marks the open experiment as selected (research-24)', () => {
    useExperimentUiStore.setState({ selectedExperimentFileName: 'depth-grid.experiment.yaml' });
    const { getByTestId } = render(<ExperimentsPanel />);
    expect(getByTestId('experiment-row-depth-grid.experiment.yaml').getAttribute('aria-current')).toBe('true');
    expect(getByTestId('experiment-row-theta-sweep.experiment.yaml').getAttribute('aria-current')).toBeNull();
  });

  it('keeps the noise-model entry reachable by accessible name (research-06)', () => {
    const { getByLabelText } = render(<ExperimentsPanel />);
    expect(getByLabelText('Noise models')).toBeTruthy();
  });

  it('surfaces a failed sweep start instead of staying silent (research-02)', () => {
    useExperimentRunStore.setState({ active: null, lastSummary: null, lastError: 'Failed to connect to kernel' });
    const { getByRole } = render(<ExperimentsPanel />);
    expect(getByRole('status').textContent).toContain("Couldn't reach the Python kernel");
  });
});
