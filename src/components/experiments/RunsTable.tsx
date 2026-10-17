import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { DEFAULT_RUNS_VIEW, useExperimentUiStore, type RunsMainTab } from '../../stores/experimentUiStore';
import { expandGrid } from '../../types/experiment';
import type { RunStatus } from '../../types/experiment';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { toCsv, downloadCsv } from '../../services/experimentExport';
import { columnDecimals, humanizeColumnLabel, isNumericColumn, deriveColumns, filterByStatus, getRunValue, sortRuns } from './runsTableColumns';
import { nextRowIndex, scrollTopToReveal } from './runsTableNavigation';
import { rememberOpenedRun, takeOpenedRun } from './runFocusMemory';
import { RunsTableRow, ROW_HEIGHT } from './RunsTableRow';
import { RunButton } from './RunButton';
import { RunFeedback } from './RunFeedback';
import { SweepPlot } from './SweepPlot';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, Select, SegmentedControl } from '../ui';
import './experiments.css';

const OVERSCAN = 6;
const STATUS_OPTIONS: Array<RunStatus | 'all'> = ['all', 'complete', 'failed', 'running', 'stale'];
const CHECKBOX_COLUMN_WIDTH = 32;
const RUN_COLUMN_WIDTH = 190;
const NARROW_RUN_COLUMN_WIDTH = 168;
const NARROW_VIEWPORT = 1000;
const MIN_DATA_COLUMN_WIDTH = 116;
const HEADER_HEIGHT = 40;

/**
 * PRD 09 Phase D (D2/D4) — the runs table: main content area when an
 * experiment is selected in Research mode. One row per run, sortable by
 * any column, filterable by status, virtualized (manual scroll-window
 * slicing — runs accumulate across invocations, but a heavy list-virtualization
 * dependency isn't warranted for what's still a bounded, in-memory array).
 *
 * PRD 09 Phase E adds: a checkbox column for multi-select ("Compare" opens
 * `CompareView` for 2+ checked runs — single-row click still opens
 * `RunDetail`, unaffected by the checkboxes), a CSV export of the currently
 * filtered/sorted table, and a Runs/Sweep plot tab switch (E2's "money
 * shot" lives one click away from the table it's derived from).
 */
export function RunsTable() {
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  // Keyed per experiment so scroll offset and virtualization state never leak
  // from one experiment's table into the next.
  return <RunsTableBody key={selectedFileName ?? ''} />;
}

function RunsTableBody() {
  const colors = useThemeStore((s) => s.colors);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const selectRun = useExperimentUiStore((s) => s.selectRun);
  const compareSelection = useExperimentUiStore((s) => s.compareSelection);
  const toggleCompareSelection = useExperimentUiStore((s) => s.toggleCompareSelection);
  const openCompare = useExperimentUiStore((s) => s.openCompare);
  const experiments = useExperimentStore((s) => s.experiments);
  const runsByExperiment = useExperimentStore((s) => s.runsByExperiment);
  const scanRuns = useExperimentStore((s) => s.scanRuns);

  const experiment = experiments.find((e) => e.fileName === selectedFileName) ?? null;
  const allRuns = useMemo(
    () => (selectedFileName ? runsByExperiment[selectedFileName] ?? [] : []),
    [runsByExperiment, selectedFileName],
  );

  const fileKey = selectedFileName ?? '';
  const storedView = useExperimentUiStore((st) => st.runsViewByExperiment[fileKey]);
  const patchRunsView = useExperimentUiStore((st) => st.patchRunsView);
  const view = storedView ?? DEFAULT_RUNS_VIEW;
  const { mainTab, sortKey, sortDirection } = view;
  const statusFilter = view.statusFilter as RunStatus | 'all';

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const latestScrollTop = useRef(view.scrollTop);
  // Offset captured the instant the user leaves for run detail / compare; the
  // scroller can report a spurious 0 while the next view is mounting.
  const leavingScrollTop = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!experiment || !projectRoot) return;
    void scanRuns(experiment, projectRoot, createTauriExperimentFs());
    // Re-scan whenever the selected experiment changes so a freshly-opened
    // experiment's on-disk runs (from a previous session) are picked up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment?.fileName, projectRoot]);

  // Callback ref so the observer attaches whenever the scroller mounts (it can
  // mount after runs arrive, or after switching back from the Sweep tab).
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    scrollRef.current = el;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    setViewportWidth(el.clientWidth);
    // Guard for environments without ResizeObserver (older webviews, jsdom).
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { setViewportHeight(el.clientHeight); setViewportWidth(el.clientWidth); });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  // Restore the saved scroll offset when the table (re)mounts, and save it on leave.
  const hasRows = allRuns.length > 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasRows) return;
    el.scrollTop = latestScrollTop.current;
    setScrollTop(el.scrollTop);
  }, [fileKey, hasRows, mainTab]);

  useEffect(() => {
    latestScrollTop.current = useExperimentUiStore.getState().runsViewByExperiment[fileKey]?.scrollTop ?? 0;
    return () => {
      if (fileKey) patchRunsView(fileKey, { scrollTop: leavingScrollTop.current ?? latestScrollTop.current });
    };
  }, [fileKey, patchRunsView]);

  const columns = useMemo(() => deriveColumns(allRuns), [allRuns]);

  const filtered = useMemo(() => filterByStatus(allRuns, statusFilter), [allRuns, statusFilter]);
  const sortColumn = columns.find((c) => c.key === sortKey) ?? null;
  const rows = useMemo(
    () => (sortColumn ? sortRuns(filtered, sortColumn, sortDirection) : filtered),
    [filtered, sortColumn, sortDirection],
  );

  const totalHeight = rows.length * ROW_HEIGHT;
  const bodyScroll = Math.max(0, scrollTop - HEADER_HEIGHT);
  const startIndex = Math.max(0, Math.floor(bodyScroll / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    Math.ceil((bodyScroll + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = rows.slice(startIndex, endIndex);
  const decimalsByColumn = useMemo(() => {
    const map = new Map<string, number>();
    for (const column of columns) map.set(column.key, columnDecimals(allRuns, column));
    return map;
  }, [columns, allRuns]);

  const runColumnWidth = viewportWidth < NARROW_VIEWPORT ? NARROW_RUN_COLUMN_WIDTH : RUN_COLUMN_WIDTH;
  const gridTemplateColumns = `${CHECKBOX_COLUMN_WIDTH}px ${runColumnWidth}px repeat(${columns.length}, minmax(${MIN_DATA_COLUMN_WIDTH}px, 1fr))`;
  const contentMinWidth = CHECKBOX_COLUMN_WIDTH + runColumnWidth + columns.length * MIN_DATA_COLUMN_WIDTH;

  // Roving tabindex: one row is the Tab stop; arrows move it. The row is
  // focused after render because virtualization may not have mounted it yet.
  const activeIndex = Math.max(0, rows.findIndex((r) => r.dir === activeDir));
  const activeRowDir = rows[activeIndex]?.dir ?? null;

  const focusRow = useCallback((dir: string) => {
    const index = rows.findIndex((r) => r.dir === dir);
    if (index < 0) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = scrollTopToReveal(index, el.scrollTop, el.clientHeight || viewportHeight, HEADER_HEIGHT);
    pendingFocusRef.current = dir;
    setActiveDir(dir);
    setScrollTop(el?.scrollTop ?? 0);
  }, [rows, viewportHeight]);

  const navigateRows = (key: string, fromDir: string) => {
    const from = rows.findIndex((r) => r.dir === fromDir);
    const pageSize = Math.max(1, Math.floor((viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1);
    const target = rows[nextRowIndex(key, from, rows.length, pageSize)];
    if (target) focusRow(target.dir);
  };

  useEffect(() => {
    const dir = pendingFocusRef.current;
    if (!dir) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-run-dir="${dir}"]`);
    if (!el) return;
    pendingFocusRef.current = null;
    el.focus({ preventScroll: true });
  });

  // Coming back from run detail: put focus on the row that opened it.
  const restoredFocusRef = useRef(false);
  useEffect(() => {
    if (restoredFocusRef.current || rows.length === 0) return;
    restoredFocusRef.current = true;
    const dir = takeOpenedRun();
    if (dir) focusRow(dir);
  }, [rows, focusRow]);

  const toggleSort = (key: string) => {
    if (sortKey !== key) patchRunsView(fileKey, { sortKey: key, sortDirection: 'asc' });
    else if (sortDirection === 'asc') patchRunsView(fileKey, { sortDirection: 'desc' });
    else patchRunsView(fileKey, { sortKey: null });
  };
  const rememberScroll = () => { leavingScrollTop.current = scrollRef.current?.scrollTop ?? latestScrollTop.current; };
  const setMainTab = (tab: RunsMainTab) => patchRunsView(fileKey, { mainTab: tab });

  const handleExportCsv = () => {
    if (!experiment) return;
    const columnKeys = ['run', ...columns.map((c) => c.key)];
    const csvRows = rows.map((run) => {
      const row: Record<string, unknown> = { run: run.dir };
      for (const column of columns) row[column.key] = getRunValue(run, column);
      return row;
    });
    downloadCsv(toCsv(csvRows, columnKeys), `${experiment.spec.name}-runs.csv`);
  };

  if (!experiment || !projectRoot) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        Select an experiment to see its runs.
      </div>
    );
  }

  const sweep = experiment.spec.type !== 'qec_campaign' ? experiment.spec.sweep : undefined;
  const pointCount = expandGrid(sweep).length;
  const hasSweep = Object.keys(sweep ?? {}).length > 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }} role="table" aria-label={`Runs for ${experiment.spec.name}`}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans }}>
          {experiment.spec.name}
        </span>
        <span style={{ color: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontMono }}>
          {rows.length} run{rows.length === 1 ? '' : 's'}
        </span>

        {hasSweep && (
          <SegmentedControl
            aria-label="Runs view"
            value={mainTab}
            onChange={setMainTab}
            options={[{ value: 'runs', label: 'Runs' }, { value: 'sweep', label: 'Sweep plot' }]}
          />
        )}

        {mainTab === 'runs' && (
          <Select
            size="sm"
            value={statusFilter}
            onChange={(e) => patchRunsView(fileKey, { statusFilter: e.target.value })}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
            ))}
          </Select>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {mainTab === 'runs' && (
            <>
              <Button
                size="sm"
                onClick={handleExportCsv}
                disabled={rows.length === 0}
                title="Export the runs table as CSV"
                icon={<Download size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
              >
                Export CSV
              </Button>
              <Button
                size="sm"
                variant={compareSelection.length >= 2 ? 'primary' : 'secondary'}
                onClick={() => { rememberScroll(); openCompare(); }}
                disabled={compareSelection.length < 2}
                title={compareSelection.length < 2 ? 'Check 2 or more runs to compare' : 'Compare the checked runs'}
              >
                Compare{compareSelection.length > 0 ? ` (${compareSelection.length})` : ''}
              </Button>
            </>
          )}
          <RunButton experiment={experiment} projectRoot={projectRoot} pointCount={pointCount} />
        </div>
      </div>

      <RunFeedback />

      {mainTab === 'sweep' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <SweepPlot />
        </div>
      ) : (
        <div
          ref={attachScroller}
          style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}
          onScroll={(e) => {
            latestScrollTop.current = e.currentTarget.scrollTop;
            setScrollTop(e.currentTarget.scrollTop);
          }}
          role="rowgroup"
        >
          <div style={{ minWidth: contentMinWidth }}>
            <div
              role="row"
              data-testid="runs-header"
              className="nuclei-runs-header"
              style={{ gridTemplateColumns, height: HEADER_HEIGHT, position: 'sticky', top: 0 }}
            >
              <div role="columnheader" aria-label="Select for comparison" className="nuclei-runs-header__sticky nuclei-runs-header__sticky--check" />
              <div role="columnheader" className="nuclei-runs-header__cell nuclei-runs-header__sticky nuclei-runs-header__sticky--run">Run</div>
              {columns.map((column) => (
                <div
                  key={column.key}
                  role="columnheader"
                  aria-sort={sortKey !== column.key ? 'none' : sortDirection === 'asc' ? 'ascending' : 'descending'}
                  className="nuclei-runs-header__cell"
                  data-numeric={isNumericColumn(column)}
                >
                  <button
                    type="button"
                    title={column.label}
                    className="nuclei-runs-header__sort"
                    data-sorted={sortKey === column.key}
                    onClick={() => toggleSort(column.key)}
                  >
                    <span className="nuclei-runs-header__label">{humanizeColumnLabel(column.label)}</span>
                    {sortKey === column.key && (sortDirection === 'asc'
                      ? <ChevronUp size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} style={{ flexShrink: 0 }} />
                      : <ChevronDown size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} style={{ flexShrink: 0 }} />)}
                  </button>
                </div>
              ))}
            </div>

            {rows.length === 0 ? (
              <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
                {allRuns.length === 0
                  ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span>{pointCount} point{pointCount === 1 ? '' : 's'} ready</span>
                      <RunButton experiment={experiment} projectRoot={projectRoot} pointCount={pointCount} label={hasSweep ? 'Run sweep' : 'Run'} />
                    </div>
                  )
                  : 'No runs match this filter.'}
              </div>
            ) : (
              <div style={{ height: totalHeight, position: 'relative' }}>
                {visibleRows.map((run, i) => (
                  <RunsTableRow
                    key={run.dir}
                    run={run}
                    columns={columns}
                    decimalsByColumn={decimalsByColumn}
                    gridTemplateColumns={gridTemplateColumns}
                    top={(startIndex + i) * ROW_HEIGHT}
                    compareSelected={compareSelection.includes(run.dir)}
                    active={run.dir === activeRowDir}
                    onFocusRow={setActiveDir}
                    onNavigate={navigateRows}
                    onSelect={(dir) => { rememberScroll(); rememberOpenedRun(dir); selectRun(dir); }}
                    onToggleCompare={toggleCompareSelection}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
