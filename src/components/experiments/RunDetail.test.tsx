// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { RunDetail } from './RunDetail';
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
};
const FILE_NAME = 'theta-sweep.experiment.yaml';
const RUN_DIR = '20260712-141530-beef';

const MANIFEST: RunManifest = {
  schema: 1,
  experiment: 'theta-sweep',
  point_index: 0,
  params: { theta: 1.5 },
  seed: 42,
  seed_honored: true,
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 100,
  language: 'python',
  entry: 'run.py',
  code_sha256: 'abc123',
  git: { commit: 'deadbeef', dirty: false },
  versions: { nuclei: '0.6.0', python: '3.12.4' },
  started_at: '2026-07-12T14:15:30Z',
  duration_ms: 1834,
  status: 'complete',
  error: null,
};

const RECORD: RunRecord = { dir: RUN_DIR, manifest: MANIFEST, metrics: { energy: -1.13 } };

const RESULT_JSON = JSON.stringify({
  state_vector: [], probabilities: {}, measurements: { '00': 60, '11': 40 },
  bloch_coords: [], execution_time_ms: 12, shot_count: 100, metrics: {},
});
const SNAPSHOT_JSON = JSON.stringify({
  framework: 'qiskit', qubit_count: 2, classical_bit_count: 2, depth: 2,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
});

function pathEndsWith(path: string, suffix: string): boolean {
  return path.endsWith(suffix);
}

describe('RunDetail', () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async (path: string) => {
      if (pathEndsWith(path, 'result.json')) return RESULT_JSON;
      if (pathEndsWith(path, 'snapshot.json')) return SNAPSHOT_JSON;
      if (pathEndsWith(path, 'stdout.txt')) return 'hello from the sweep\n';
      if (pathEndsWith(path, 'stderr.txt')) return '';
      throw new Error(`ENOENT: ${path}`);
    });

    useProjectStore.setState({ projectRoot: '/proj', tabs: [], activeTabPath: null });
    useExperimentStore.setState({
      loading: false,
      experiments: [{ fileName: FILE_NAME, path: `/proj/experiments/${FILE_NAME}`, spec: SPEC }],
      validationErrors: [],
      runsByExperiment: { [FILE_NAME]: [RECORD] },
      reload: vi.fn(async () => {}),
      scanRuns: vi.fn(async () => {}),
      startWatching: vi.fn(async () => {}),
      stopWatching: vi.fn(),
    });
    useExperimentUiStore.setState({ selectedExperimentFileName: FILE_NAME, selectedRunDir: RUN_DIR });
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
    useExperimentUiStore.setState({ selectedExperimentFileName: null, selectedRunDir: null });
  });

  it('renders the manifest as a definition list', async () => {
    const { getByText } = render(<RunDetail />);
    await waitFor(() => expect(getByText(/hello from the sweep/)).toBeTruthy());

    expect(getByText('Status')).toBeTruthy();
    expect(getByText('complete')).toBeTruthy();
    expect(getByText(/"theta":1\.5/)).toBeTruthy();
    expect(getByText(/deadbeef/)).toBeTruthy();
  });

  it('renders the measurements histogram once result.json loads', async () => {
    // Recharts' ResponsiveContainer needs a real layout box to draw bars,
    // which jsdom can't provide — assert it left the "no measurements" empty
    // state once real measurements arrive (the meaningful behavior here:
    // RunHistogram received and used artifacts.result.measurements).
    const { container, queryByText } = render(<RunDetail />);
    await waitFor(() => expect(container.querySelector('.recharts-responsive-container')).toBeTruthy());
    expect(queryByText(/no measurements recorded/i)).toBeNull();
  });

  it('renders the circuit snapshot once snapshot.json loads', async () => {
    const { container } = render(<RunDetail />);
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy());
  });

  it('switches between stdout and stderr tabs', async () => {
    const { getByText, getByRole } = render(<RunDetail />);
    await waitFor(() => expect(getByText(/hello from the sweep/)).toBeTruthy());

    fireEvent.click(getByRole('tab', { name: 'stderr' }));
    expect(getByText(/No stderr recorded/)).toBeTruthy();
  });

  it('back button clears the selected run', async () => {
    const { getByText } = render(<RunDetail />);
    fireEvent.click(getByText('Back to runs'));
    expect(useExperimentUiStore.getState().selectedRunDir).toBeNull();
  });

  it('shows a placeholder when nothing is selected', () => {
    useExperimentUiStore.setState({ selectedExperimentFileName: null, selectedRunDir: null });
    const { getByText } = render(<RunDetail />);
    expect(getByText(/select a run/i)).toBeTruthy();
  });
});
