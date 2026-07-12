import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { expandGrid } from '../../types/experiment';
import type { RunStatus } from '../../types/experiment';
import { createTauriExperimentFs } from '../../services/experimentFs';
import { deriveColumns, filterByStatus, sortRuns, type SortDirection } from './runsTableColumns';
import { RunsTableRow, ROW_HEIGHT } from './RunsTableRow';
import { RunButton } from './RunButton';

const OVERSCAN = 6;
const STATUS_OPTIONS: Array<RunStatus | 'all'> = ['all', 'complete', 'failed', 'running', 'stale'];

/**
 * PRD 09 Phase D (D2/D4) — the runs table: main content area when an
 * experiment is selected in Research mode. One row per run, sortable by
 * any column, filterable by status, virtualized (manual scroll-window
 * slicing — runs accumulate across invocations, but a heavy list-virtualization
 * dependency isn't warranted for what's still a bounded, in-memory array).
 */
export function RunsTable() {
  const colors = useThemeStore((s) => s.colors);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const selectRun = useExperimentUiStore((s) => s.selectRun);
  const experiments = useExperimentStore((s) => s.experiments);
  const runsByExperiment = useExperimentStore((s) => s.runsByExperiment);
  const scanRuns = useExperimentStore((s) => s.scanRuns);

  const experiment = experiments.find((e) => e.fileName === selectedFileName) ?? null;
  const allRuns = useMemo(
    () => (selectedFileName ? runsByExperiment[selectedFileName] ?? [] : []),
    [runsByExperiment, selectedFileName],
  );

  const [statusFilter, setStatusFilter] = useState<RunStatus | 'all'>('all');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!experiment || !projectRoot) return;
    void scanRuns(experiment, projectRoot, createTauriExperimentFs());
    // Re-scan whenever the selected experiment changes so a freshly-opened
    // experiment's on-disk runs (from a previous session) are picked up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment?.fileName, projectRoot]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    // Guard for environments without ResizeObserver (older webviews, jsdom
    // under test) — the virtualized window just falls back to a fixed
    // initial height instead of tracking live resizes.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => deriveColumns(allRuns), [allRuns]);

  const filtered = useMemo(() => filterByStatus(allRuns, statusFilter), [allRuns, statusFilter]);
  const sortColumn = columns.find((c) => c.key === sortKey) ?? null;
  const rows = useMemo(
    () => (sortColumn ? sortRuns(filtered, sortColumn, sortDirection) : filtered),
    [filtered, sortColumn, sortDirection],
  );

  const totalHeight = rows.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = rows.slice(startIndex, endIndex);

  const gridTemplateColumns = `140px repeat(${columns.length}, minmax(90px, 1fr))`;

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else {
      setSortKey(null);
    }
  };

  if (!experiment || !projectRoot) {
    return (
      <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        Select an experiment to see its runs.
      </div>
    );
  }

  const pointCount = expandGrid(experiment.spec.sweep).length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }} role="table" aria-label={`Runs for ${experiment.spec.name}`}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
      }}>
        <span style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif" }}>
          {experiment.spec.name}
        </span>
        <span style={{ color: colors.textDim, fontSize: 11, fontFamily: "'Fira Code', monospace" }}>
          {rows.length} run{rows.length === 1 ? '' : 's'}
        </span>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RunStatus | 'all')}
          aria-label="Filter by status"
          style={{
            marginLeft: 'auto', background: colors.bgPanel, color: colors.text,
            border: `1px solid ${colors.border}`, borderRadius: 4, padding: '3px 8px',
            fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
          ))}
        </select>

        <RunButton experiment={experiment} projectRoot={projectRoot} pointCount={pointCount} />
      </div>

      {/* Column headers */}
      <div
        role="row"
        style={{
          display: 'grid', gridTemplateColumns,
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgPanel, flexShrink: 0,
        }}
      >
        <div role="columnheader" style={{ padding: '6px 8px', color: colors.textDim, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', fontFamily: "'Geist Sans', sans-serif" }}>
          Run
        </div>
        {columns.map((column) => (
          <button
            key={column.key}
            role="columnheader"
            onClick={() => toggleSort(column.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '6px 8px', background: 'transparent', border: 'none',
              color: sortKey === column.key ? colors.accent : colors.textDim,
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              fontFamily: "'Geist Sans', sans-serif", cursor: 'pointer', textAlign: 'left',
            }}
          >
            {column.label}
            {sortKey === column.key && (sortDirection === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
          </button>
        ))}
      </div>

      {/* Virtualized body */}
      {rows.length === 0 ? (
        <div style={{ padding: 24, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
          No runs yet. Hit Run to start a sweep.
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{ flex: 1, overflow: 'auto', position: 'relative' }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          role="rowgroup"
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visibleRows.map((run, i) => (
              <RunsTableRow
                key={run.dir}
                run={run}
                columns={columns}
                gridTemplateColumns={gridTemplateColumns}
                top={(startIndex + i) * ROW_HEIGHT}
                onSelect={selectRun}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
