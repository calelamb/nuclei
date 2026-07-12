// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CompareView } from './CompareView';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import type { ExperimentSpec, RunManifest, RunRecord } from '../../types/experiment';

const readTextFileMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async () => {}),
  readDir: vi.fn(async () => []),
  readTextFile: readTextFileMock,
  exists: vi.fn(async () => false),
  watch: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));

const SPEC: ExperimentSpec = {
  schema: 1,
  name: 'theta-sweep',
  entry: 'run.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 100,
  seed: 42,
  sweep: { theta: { values: [0, 1] } },
};
const FILE_NAME = 'theta-sweep.experiment.yaml';

function manifest(overrides: Partial<RunManifest>): RunManifest {
  return {
    schema: 1,
    experiment: 'theta-sweep',
    point_index: 0,
    params: { theta: 0 },
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

const RUN_A = 'run-a';
const RUN_B = 'run-b';

const RECORDS: RunRecord[] = [
  { dir: RUN_A, manifest: manifest({ params: { theta: 0 }, point_index: 0 }), metrics: { energy: -1.0 } },
  { dir: RUN_B, manifest: manifest({ params: { theta: 1 }, point_index: 1 }), metrics: { energy: -2.0 } },
];

function resultJsonFor(dir: string): string {
  const measurements = dir === RUN_A ? { '00': 80, '11': 20 } : { '00': 30, '11': 70 };
  return JSON.stringify({
    state_vector: [], probabilities: {}, measurements,
    bloch_coords: [], execution_time_ms: 5, shot_count: 100, metrics: {},
  });
}

describe('CompareView', () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path.includes(RUN_A) && path.endsWith('result.json')) return resultJsonFor(RUN_A);
      if (path.includes(RUN_B) && path.endsWith('result.json')) return resultJsonFor(RUN_B);
      throw new Error(`ENOENT: ${path}`);
    });

    useProjectStore.setState({ projectRoot: '/proj', tabs: [], activeTabPath: null });
    useExperimentStore.setState({
      loading: false,
      experiments: [{ fileName: FILE_NAME, path: `/proj/experiments/${FILE_NAME}`, spec: SPEC }],
      validationErrors: [],
      runsByExperiment: { [FILE_NAME]: RECORDS },
      reload: vi.fn(async () => {}),
      scanRuns: vi.fn(async () => {}),
      startWatching: vi.fn(async () => {}),
      stopWatching: vi.fn(),
    });
    useExperimentUiStore.setState({
      selectedExperimentFileName: FILE_NAME,
      selectedRunDir: null,
      compareSelection: [RUN_A, RUN_B],
      compareOpen: true,
    });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
    useExperimentUiStore.setState({
      selectedExperimentFileName: null, selectedRunDir: null, compareSelection: [], compareOpen: false,
    });
  });

  it('renders a smoke-test comparison of the fixture runs: title, histogram, diff, metrics', async () => {
    const { getByText, getAllByText, container } = render(<CompareView />);

    expect(getByText(/Compare 2 runs/)).toBeTruthy();
    expect(getByText(/theta-sweep/)).toBeTruthy();

    // Histogram — assert the recharts chart mounted (see RunDetail.test.tsx
    // for why: jsdom can't lay out ResponsiveContainer to draw actual bars).
    await waitFor(() => expect(container.querySelector('.recharts-responsive-container')).toBeTruthy());

    // Manifest diff — theta differs, everything else (seed, backend, etc.)
    // is identical and collapsed. Both runs' dirs appear twice (once as a
    // diff-table column header, once as a metrics-table row label).
    expect(getByText('params.theta')).toBeTruthy();
    expect(getAllByText(RUN_A).length).toBeGreaterThanOrEqual(2);
    expect(getAllByText(RUN_B).length).toBeGreaterThanOrEqual(2);

    // Metrics table — one row per run, one column per metric.
    expect(getByText('energy')).toBeTruthy();
    expect(getByText('-1.0000')).toBeTruthy();
    expect(getByText('-2.0000')).toBeTruthy();
  });

  it('clear selection empties the compare selection and closes the view', async () => {
    const { getByText } = render(<CompareView />);
    fireEvent.click(getByText(/Clear selection/));
    expect(useExperimentUiStore.getState().compareSelection).toEqual([]);
    expect(useExperimentUiStore.getState().compareOpen).toBe(false);
  });

  it('back to runs closes the compare view', async () => {
    const { getByText } = render(<CompareView />);
    fireEvent.click(getByText(/Back to runs/));
    expect(useExperimentUiStore.getState().compareOpen).toBe(false);
  });

  it('shows a placeholder when fewer than 2 runs are selected', () => {
    useExperimentUiStore.setState({ compareSelection: [RUN_A] });
    const { getByText } = render(<CompareView />);
    expect(getByText(/select at least 2 runs/i)).toBeTruthy();
  });
});
