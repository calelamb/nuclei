// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { RunsTable } from './RunsTable';
import { useExperimentStore } from '../../services/experimentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import type { ExperimentSpec, RunManifest, RunRecord } from '../../types/experiment';

const SPEC: ExperimentSpec = {
  schema: 1,
  name: 'theta-sweep',
  entry: 'run.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 100,
  seed: 42,
  sweep: { theta: { values: [0, 1, 2] } },
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

function record(dir: string, manifestOverrides: Partial<RunManifest>, metrics: Record<string, number> = {}): RunRecord {
  return { dir, manifest: manifest(manifestOverrides), metrics };
}

const RUNS: RunRecord[] = [
  record('20260712-000001-aaaa', { params: { theta: 2 }, status: 'complete' }, { energy: -1.5 }),
  record('20260712-000002-bbbb', { params: { theta: 0 }, status: 'failed' }, { energy: -0.5 }),
  record('20260712-000003-cccc', { params: { theta: 1 }, status: 'complete' }, { energy: -2.0 }),
];

function installFixtureStore() {
  useExperimentStore.setState({
    loading: false,
    experiments: [{ fileName: FILE_NAME, path: `/proj/experiments/${FILE_NAME}`, spec: SPEC }],
    validationErrors: [],
    runsByExperiment: { [FILE_NAME]: RUNS },
    reload: vi.fn(async () => {}),
    scanRuns: vi.fn(async () => {}),
    startWatching: vi.fn(async () => {}),
    stopWatching: vi.fn(),
  });
}

const RUN_DIR_RE = /^\d{8}-\d{6}-[a-z0-9]{4}/;

/** Rows are absolutely positioned by `top`, ordered as rendered — this reads
 * the "Run" (dir) column back off the DOM in the order the component chose.
 * (The column-header bar also has `role="row"`, so filter to rows whose text
 * actually starts with a run-dir slug.) */
function bodyRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="row"]'))
    .filter((row) => RUN_DIR_RE.test(row.textContent ?? ''));
}

function visibleRunDirs(container: HTMLElement): string[] {
  return bodyRows(container).map((row) => row.textContent!.match(RUN_DIR_RE)![0]);
}

describe('RunsTable', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectRoot: '/proj', tabs: [], activeTabPath: null });
    useExperimentUiStore.setState({
      selectedExperimentFileName: FILE_NAME, selectedRunDir: null,
      compareSelection: [], compareOpen: false,
    });
    useExperimentRunStore.setState({ active: null, lastSummary: null, lastError: null });
    installFixtureStore();
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
    useExperimentUiStore.setState({
      selectedExperimentFileName: null, selectedRunDir: null,
      compareSelection: [], compareOpen: false,
    });
  });

  it('renders one row per fixture run manifest', () => {
    const { container } = render(<RunsTable />);
    expect(visibleRunDirs(container)).toHaveLength(3);
  });

  it('sorts ascending by the swept param column (theta)', () => {
    const { container, getByText } = render(<RunsTable />);
    fireEvent.click(getByText('theta'));
    expect(visibleRunDirs(container)).toEqual([
      '20260712-000002-bbbb', // theta 0
      '20260712-000003-cccc', // theta 1
      '20260712-000001-aaaa', // theta 2
    ]);
  });

  it('sorts descending by a metric column (energy) after a second click', () => {
    const { container, getByText } = render(<RunsTable />);
    fireEvent.click(getByText('energy'));
    expect(visibleRunDirs(container)[0]).toBe('20260712-000003-cccc'); // -2.0 asc first
    fireEvent.click(getByText('energy'));
    expect(visibleRunDirs(container)[0]).toBe('20260712-000002-bbbb'); // -0.5 desc first
  });

  it('filters by status', () => {
    const { container, getByLabelText } = render(<RunsTable />);
    fireEvent.change(getByLabelText('Filter by status'), { target: { value: 'failed' } });
    expect(visibleRunDirs(container)).toEqual(['20260712-000002-bbbb']);
  });

  it('selecting a row updates the UI store', () => {
    const { container } = render(<RunsTable />);
    fireEvent.click(bodyRows(container)[0]);
    expect(useExperimentUiStore.getState().selectedRunDir).toBe('20260712-000001-aaaa');
  });

  it('shows a placeholder when no experiment is selected', () => {
    useExperimentUiStore.setState({ selectedExperimentFileName: null, selectedRunDir: null });
    const { getByText } = render(<RunsTable />);
    expect(getByText(/select an experiment/i)).toBeTruthy();
  });

  it('checking a row does not also select it for detail (checkbox click is isolated from row click)', () => {
    const { container } = render(<RunsTable />);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(useExperimentUiStore.getState().selectedRunDir).toBeNull();
    expect(useExperimentUiStore.getState().compareSelection).toEqual(['20260712-000001-aaaa']);
  });

  it('Compare button is disabled until 2+ runs are checked, then opens the compare view', () => {
    const { container, getByText } = render(<RunsTable />);
    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    const compareButton = getByText(/^Compare/) as HTMLButtonElement;
    expect(compareButton.disabled).toBe(true);

    fireEvent.click(checkboxes[0]);
    expect(compareButton.disabled).toBe(true);

    fireEvent.click(checkboxes[1]);
    expect(compareButton.disabled).toBe(false);

    fireEvent.click(compareButton);
    expect(useExperimentUiStore.getState().compareOpen).toBe(true);
  });

  it('switches to the sweep plot tab when the experiment has swept parameters', () => {
    const { getByText, queryByLabelText } = render(<RunsTable />);
    fireEvent.click(getByText('Sweep plot'));
    expect(queryByLabelText('X parameter')).toBeTruthy();
  });
});
