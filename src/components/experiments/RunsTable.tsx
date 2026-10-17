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
import { columnDecimals, deriveColumns, filterByStatus, getRunValue, sortRuns } from './runsTableColumns';
import { RunsTableRow, ROW_HEIGHT } from './RunsTableRow';
import { RunButton } from './RunButton';
import { RunFeedback } from './RunFeedback';
import { SweepPlot } from './SweepPlot';

const OVERSCAN = 6;
const STATUS_OPTIONS: Array<RunStatus | 'all'> = ['all', 'complete', 'failed', 'running', 'stale'];
const CHECKBOX_COLUMN_WIDTH = 32;
const RUN_COLUMN_WIDTH = 190;
const MIN_DATA_COLUMN_WIDTH = 96;
const HEADER_HEIGHT = 28;

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const latestScrollTop = useRef(view.scrollTop);
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
    // Guard for environments without ResizeObserver (older webviews, jsdom).
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
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
      if (fileKey) patchRunsView(fileKey, { scrollTop: latestScrollTop.current });
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

  const gridTemplateColumns = `${CHECKBOX_COLUMN_WIDTH}px ${RUN_COLUMN_WIDTH}px repeat(${columns.length}, minmax(${MIN_DATA_COLUMN_WIDTH}px, 1fr))`;
  const contentMinWidth = CHECKBOX_COLUMN_WIDTH + RUN_COLUMN_WIDTH + columns.length * MIN_DATA_COLUMN_WIDTH;

  const toggleSort = (key: string) => {
    if (sortKey !== key) patchRunsView(fileKey, { sortKey: key, sortDirection: 'asc' });
    else if (sortDirection === 'asc') patchRunsView(fileKey, { sortDirection: 'desc' });
    else patchRunsView(fileKey, { sortKey: null });
  };
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
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
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
        padding: '10px 14px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif" }}>
          {experiment.spec.name}
        </span>
        <span style={{ color: colors.textDim, fontSize: 11, fontFamily: "'Fira Code', monospace" }}>
          {rows.length} run{rows.length === 1 ? '' : 's'}
        </span>

        {hasSweep && (
          <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${colors.border}` }}>
            {(['runs', 'sweep'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMainTab(tab)}
                style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: mainTab === tab ? colors.accent : 'transparent',
                  color: mainTab === tab ? '#0a1220' : colors.textDim,
                  fontFamily: "'Geist Sans', sans-serif",
                }}
              >
                {tab === 'runs' ? 'Runs' : 'Sweep plot'}
              </button>
            ))}
          </div>
        )}

        {mainTab === 'runs' && (
          <select
            value={statusFilter}
            onChange={(e) => patchRunsView(fileKey, { statusFilter: e.target.value })}
            aria-label="Filter by status"
            style={{
              background: colors.bgPanel, color: colors.text,
              border: `1px solid ${colors.border}`, borderRadius: 4, padding: '3px 8px',
              fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
            ))}
          </select>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {mainTab === 'runs' && (
            <>
              <button
                onClick={handleExportCsv}
                disabled={rows.length === 0}
                title="Export the runs table as CSV"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', background: 'transparent', border: `1px solid ${colors.border}`,
                  borderRadius: 4, color: colors.textMuted, cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
                }}
              >
                <Download size={12} /> Export CSV
              </button>
              <button
                onClick={openCompare}
                disabled={compareSelection.length < 2}
                title={compareSelection.length < 2 ? 'Check 2 or more runs to compare' : 'Compare the checked runs'}
                style={{
                  padding: '4px 10px',
                  background: compareSelection.length >= 2 ? colors.accent : colors.border,
                  color: compareSelection.length >= 2 ? '#0a1220' : colors.textDim,
                  border: 'none', borderRadius: 4,
                  cursor: compareSelection.length >= 2 ? 'pointer' : 'not-allowed',
                  fontSize: 11, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
                }}
              >
                Compare{compareSelection.length > 0 ? ` (${compareSelection.length})` : ''}
              </button>
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
              style={{
                display: 'grid', gridTemplateColumns, height: HEADER_HEIGHT, boxSizing: 'border-box',
                position: 'sticky', top: 0, zIndex: 2,
                borderBottom: `1px solid ${colors.border}`, background: colors.bgPanel,
              }}
            >
              <div role="columnheader" aria-label="Select for comparison" />
              <div role="columnheader" style={{ ...HEADER_CELL, color: colors.textDim, display: 'flex', alignItems: 'center' }}>
                Run
              </div>
              {columns.map((column) => (
                <button
                  key={column.key}
                  role="columnheader"
                  title={column.label}
                  onClick={() => toggleSort(column.key)}
                  style={{
                    ...HEADER_CELL, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0,
                    justifyContent: column.kind === 'field' && column.key === 'status' ? 'flex-start' : 'flex-end',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: sortKey === column.key ? colors.accent : colors.textDim,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{column.label}</span>
                  {sortKey === column.key && (sortDirection === 'asc' ? <ChevronUp size={10} style={{ flexShrink: 0 }} /> : <ChevronDown size={10} style={{ flexShrink: 0 }} />)}
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
                {allRuns.length === 0 ? 'No runs yet. Hit Run to start a sweep.' : 'No runs match this filter.'}
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
                    onSelect={selectRun}
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

const HEADER_CELL: React.CSSProperties = {
  padding: '0 8px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  fontFamily: "'Geist Sans', sans-serif", textAlign: 'right',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
