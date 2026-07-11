// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ExperimentsPanel } from './ExperimentsPanel';
import { useExperimentStore } from '../../services/experimentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import type { ExperimentSpec } from '../../types/experiment';

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
    const { getByText } = render(<ExperimentsPanel />);
    expect(getByText('theta-sweep')).toBeTruthy();
    expect(getByText(/run\.py/)).toBeTruthy();
    expect(getByText(/simulator\/statevector/)).toBeTruthy();
    expect(getByText(/3 points/)).toBeTruthy();
  });

  it('renders malformed experiments as a validation-error card, not a crash', () => {
    const { getByText, getAllByRole } = render(<ExperimentsPanel />);
    const alerts = getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('broken.experiment.yaml');
    expect(getByText(/shots: Invalid input/)).toBeTruthy();
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
});
