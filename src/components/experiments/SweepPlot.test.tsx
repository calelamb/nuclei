// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SweepPlot } from './SweepPlot';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import type { ExperimentSpec, RunManifest, RunRecord } from '../../types/experiment';

const SPEC: ExperimentSpec = {
  schema: 1,
  name: 'theta-sweep',
  entry: 'run.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 100,
  seed: 42,
  sweep: {
    theta: { values: [0, 1] },
    layers: { values: [1, 2] },
  },
};
const FILE_NAME = 'theta-sweep.experiment.yaml';

function manifest(overrides: Partial<RunManifest>): RunManifest {
  return {
    schema: 1,
    experiment: 'theta-sweep',
    point_index: 0,
    params: { theta: 0, layers: 1 },
    seed: 42,
    seed_honored: true,
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 100,
    language: 'python',
    entry: 'run.py',
    code_sha256: 'abc',
    git: null,
    versions: { nuclei: '0.6.0' },
    started_at: '2026-07-12T14:15:30Z',
    duration_ms: 10,
    status: 'complete',
    error: null,
    ...overrides,
  };
}

function record(dir: string, params: Record<string, number>, energy: number): RunRecord {
  return { dir, manifest: manifest({ params }), metrics: { energy } };
}

const RUNS: RunRecord[] = [
  record('a', { theta: 0, layers: 1 }, -0.1),
  record('b', { theta: 1, layers: 1 }, -0.2),
  record('c', { theta: 0, layers: 2 }, -1.0),
  record('d', { theta: 1, layers: 2 }, -2.0),
];

function installStore(spec: ExperimentSpec, runs: RunRecord[]) {
  useExperimentStore.setState({
    loading: false,
    experiments: [{ fileName: FILE_NAME, path: `/proj/experiments/${FILE_NAME}`, spec }],
    validationErrors: [],
    runsByExperiment: { [FILE_NAME]: runs },
    reload: vi.fn(async () => {}),
    scanRuns: vi.fn(async () => {}),
    startWatching: vi.fn(async () => {}),
    stopWatching: vi.fn(),
  });
}

describe('SweepPlot', () => {
  beforeEach(() => {
    useExperimentUiStore.setState({ selectedExperimentFileName: FILE_NAME, selectedRunDir: null });
    installStore(SPEC, RUNS);
  });

  afterEach(() => {
    cleanup();
    useExperimentUiStore.setState({ selectedExperimentFileName: null, selectedRunDir: null });
  });

  it('renders a smoke-test sweep plot from fixture runs with default X/Y pickers', () => {
    const { container, getByLabelText } = render(<SweepPlot />);
    expect((getByLabelText('X parameter') as HTMLSelectElement).value).toBe('theta');
    expect((getByLabelText('Y metric') as HTMLSelectElement).value).toBe('energy');
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).toBeTruthy();
    // 4 fixture points plotted as circles.
    expect(container.querySelectorAll('circle')).toHaveLength(4);
  });

  it('shows a per-group legend once "Group by" is set to the other swept parameter', () => {
    const { getByLabelText, getByText } = render(<SweepPlot />);
    fireEvent.change(getByLabelText('Group by parameter'), { target: { value: 'layers' } });
    expect(getByText('layers = 1')).toBeTruthy();
    expect(getByText('layers = 2')).toBeTruthy();
  });

  it('shows a placeholder when the experiment has no swept parameters', () => {
    installStore({ ...SPEC, sweep: undefined }, RUNS);
    const { getByText } = render(<SweepPlot />);
    expect(getByText(/no swept parameters/i)).toBeTruthy();
  });

  it('shows a placeholder when no metrics have been recorded yet', () => {
    const noMetricRuns: RunRecord[] = RUNS.map((r) => ({ ...r, metrics: {} }));
    installStore(SPEC, noMetricRuns);
    const { getByText } = render(<SweepPlot />);
    expect(getByText(/no metrics recorded/i)).toBeTruthy();
  });

  it('shows a placeholder when no experiment is selected', () => {
    useExperimentUiStore.setState({ selectedExperimentFileName: null, selectedRunDir: null });
    const { getByText } = render(<SweepPlot />);
    expect(getByText(/select an experiment/i)).toBeTruthy();
  });
});
