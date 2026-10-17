// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
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


/** Rows are absolutely positioned by `top`, ordered as rendered — this reads
 * the "Run" (dir) column back off the DOM in the order the component chose.
 * (The column-header bar also has `role="row"`, so filter to rows whose text
 * actually starts with a run-dir slug.) */
function bodyRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-run-dir]'));
}

function visibleRunDirs(container: HTMLElement): string[] {
  return bodyRows(container).map((row) => row.dataset.runDir!);
}

describe('RunsTable', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectRoot: '/proj', tabs: [], activeTabPath: null });
    useExperimentUiStore.setState({
      selectedExperimentFileName: FILE_NAME, selectedRunDir: null,
      compareSelection: [], compareOpen: false, runsViewByExperiment: {},
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

  it('keeps column headers inside the horizontally scrolling body so they stay aligned (research-03)', () => {
    const { container } = render(<RunsTable />);
    const scroller = container.querySelector('[role="rowgroup"]') as HTMLElement;
    const header = container.querySelector('[data-testid="runs-header"]') as HTMLElement;
    expect(scroller.contains(header)).toBe(true);
    expect(header.style.position).toBe('sticky');
  });

  it('renders every visible row after runs arrive post-mount (research-04)', () => {
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
    useExperimentStore.setState({ runsByExperiment: { [FILE_NAME]: [] } });
    const { container } = render(<RunsTable />);
    const many = Array.from({ length: 80 }, (_, i) =>
      record(`20260712-${String(i).padStart(6, '0')}-aaaa`, { params: { theta: i } }));
    act(() => { useExperimentStore.setState({ runsByExperiment: { [FILE_NAME]: many } }); });
    // 900px / 30px rows = 30 visible (+ overscan below)
    expect(bodyRows(container).length).toBeGreaterThanOrEqual(30);
    clientHeight.mockRestore();
  });

  it('keeps sort and filter after unmounting for run detail and coming back (research-12)', () => {
    const first = render(<RunsTable />);
    fireEvent.click(first.getByText('energy'));
    fireEvent.change(first.getByLabelText('Filter by status'), { target: { value: 'complete' } });
    first.unmount();
    const { container, getByLabelText } = render(<RunsTable />);
    expect((getByLabelText('Filter by status') as HTMLSelectElement).value).toBe('complete');
    expect(visibleRunDirs(container)).toEqual(['20260712-000003-cccc', '20260712-000001-aaaa']);
  });

  it('shows a failed-start error under the header (research-02)', () => {
    useExperimentRunStore.setState({ lastError: 'Failed to connect to kernel' });
    const { getByRole } = render(<RunsTable />);
    expect(getByRole('status').textContent).toContain("Couldn't reach the Python kernel");
  });

  it('formats a numeric column with consistent decimals (research-18)', () => {
    useExperimentStore.setState({
      runsByExperiment: { [FILE_NAME]: [
        record('20260712-000001-aaaa', { params: { theta: 6.2 } }),
        record('20260712-000002-bbbb', { params: { theta: 6 } }),
      ] },
    });
    const { container } = render(<RunsTable />);
    const cells = Array.from(container.querySelectorAll('[data-run-dir]')).map((r) => r.querySelectorAll('[role="cell"]')[2].textContent);
    expect(cells).toEqual(['6.2', '6.0']);
  });

  it('restores the saved scroll offset when returning to the table (research-12)', () => {
    useExperimentUiStore.getState().patchRunsView(FILE_NAME, { scrollTop: 120 });
    const { container } = render(<RunsTable />);
    expect((container.querySelector('[role="rowgroup"]') as HTMLElement).scrollTop).toBe(120);
  });
  it('keeps scroll offsets separate per experiment (research-12 regression)', () => {
    const other = 'other.experiment.yaml';
    useExperimentStore.setState({
      experiments: [
        { fileName: FILE_NAME, path: `/proj/experiments/${FILE_NAME}`, spec: SPEC },
        { fileName: other, path: `/proj/experiments/${other}`, spec: { ...SPEC, name: 'other' } },
      ],
      runsByExperiment: { [FILE_NAME]: RUNS, [other]: RUNS },
    });
    const { container } = render(<RunsTable />);
    const scroller = () => container.querySelector('[role="rowgroup"]') as HTMLElement;
    scroller().scrollTop = 500;
    fireEvent.scroll(scroller());
    act(() => { useExperimentUiStore.setState({ selectedExperimentFileName: other }); });
    expect(scroller().scrollTop).toBe(0);
    scroller().scrollTop = 1200;
    fireEvent.scroll(scroller());
    act(() => { useExperimentUiStore.setState({ selectedExperimentFileName: FILE_NAME }); });
    expect(scroller().scrollTop).toBe(500);
    act(() => { useExperimentUiStore.setState({ selectedExperimentFileName: other }); });
    expect(scroller().scrollTop).toBe(1200);
  });

  describe('keyboard model (LR-10)', () => {
    it('exposes aria-sort on every sortable column header', () => {
      const { container, getByText } = render(<RunsTable />);
      const headerFor = (label: string) => getByText(label).closest('[role="columnheader"]') as HTMLElement;
      expect(headerFor('theta').getAttribute('aria-sort')).toBe('none');
      fireEvent.click(getByText('theta'));
      expect(headerFor('theta').getAttribute('aria-sort')).toBe('ascending');
      fireEvent.click(getByText('theta'));
      expect(headerFor('theta').getAttribute('aria-sort')).toBe('descending');
      expect(container.querySelectorAll('[role="columnheader"][aria-sort="none"]').length).toBeGreaterThan(1);
    });

    it('makes exactly one row (and one checkbox) a tab stop', () => {
      const { container } = render(<RunsTable />);
      const stops = Array.from(container.querySelectorAll<HTMLElement>('[data-run-dir], [data-run-dir] input')).filter((el) => el.tabIndex === 0);
      expect(stops).toHaveLength(2);
      expect(bodyRows(container)[0].tabIndex).toBe(0);
    });

    it('moves the roving stop with the arrow keys and focuses the row', () => {
      const { container } = render(<RunsTable />);
      const rows = bodyRows(container);
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(bodyRows(container)[1]);
      expect(bodyRows(container)[1].tabIndex).toBe(0);
      expect(bodyRows(container)[0].tabIndex).toBe(-1);
      fireEvent.keyDown(bodyRows(container)[1], { key: 'End' });
      expect(document.activeElement).toBe(bodyRows(container)[2]);
      fireEvent.keyDown(bodyRows(container)[2], { key: 'Home' });
      expect(document.activeElement).toBe(bodyRows(container)[0]);
    });

    it('opens a row with Enter and toggles comparison with Space', () => {
      const { container } = render(<RunsTable />);
      const row = bodyRows(container)[0];
      row.focus();
      fireEvent.keyDown(row, { key: ' ' });
      expect(useExperimentUiStore.getState().compareSelection).toEqual(['20260712-000001-aaaa']);
      fireEvent.keyDown(row, { key: 'Enter' });
      expect(useExperimentUiStore.getState().selectedRunDir).toBe('20260712-000001-aaaa');
    });

    it('returns focus to the row that opened run detail (LR-10)', () => {
      const first = render(<RunsTable />);
      fireEvent.click(bodyRows(first.container)[1]);
      first.unmount();
      const { container } = render(<RunsTable />);
      expect(document.activeElement).toBe(bodyRows(container)[1]);
    });

    it('shows how many points are ready when there are no runs yet', () => {
      useExperimentStore.setState({ runsByExperiment: { [FILE_NAME]: [] } });
      const { getByText } = render(<RunsTable />);
      expect(getByText(/point(s)? ready/)).toBeTruthy();
    });
  });
});
