import { Badge, Checkbox, type BadgeTone } from '../ui';
import { formatRunLabel, isNumericColumn, getRunValue, type RunColumn } from './runsTableColumns';
import type { RunRecord, RunStatus } from '../../types/experiment';
import { ROW_NAV_KEYS } from './runsTableNavigation';

export const ROW_HEIGHT = 30;

const STATUS_TONE: Record<RunStatus, BadgeTone> = {
  complete: 'success',
  failed: 'danger',
  running: 'warning',
  stale: 'neutral',
};

function formatCell(value: number | string | boolean | null, column: RunColumn, decimals: number): string {
  if (value === null) return '—';
  if (column.key === 'duration_ms') return `${(value as number).toLocaleString()}`;
  if (column.key === 'seed_honored') return value ? 'yes' : 'no';
  if (column.key === 'seed') return String(value);
  if (typeof value === 'number') return value.toFixed(decimals);
  return String(value);
}

interface RunsTableRowProps {
  run: RunRecord;
  columns: RunColumn[];
  /** Decimals per numeric column so every row of a column prints identically. */
  decimalsByColumn: ReadonlyMap<string, number>;
  gridTemplateColumns: string;
  top: number;
  /** PRD 09 Phase E — whether this row is checked for the Compare view. */
  compareSelected: boolean;
  /** Roving tabindex: only the active row is a Tab stop. */
  active: boolean;
  onSelect(dir: string): void;
  onNavigate(key: string, dir: string): void;
  onFocusRow(dir: string): void;
  onToggleCompare(dir: string): void;
}

/** One virtualized, absolutely-positioned row in `RunsTable`. */
export function RunsTableRow({
  run,
  columns,
  decimalsByColumn,
  gridTemplateColumns,
  top,
  compareSelected,
  active,
  onSelect,
  onNavigate,
  onFocusRow,
  onToggleCompare,
}: RunsTableRowProps) {
  const statusTone = STATUS_TONE[run.manifest.status];

  return (
    <div
      role="row"
      className="nuclei-runs-row"
      data-run-dir={run.dir}
      data-checked={compareSelected}
      tabIndex={active ? 0 : -1}
      aria-selected={compareSelected}
      onClick={() => onSelect(run.dir)}
      onFocus={(e) => { if (e.target === e.currentTarget) onFocusRow(run.dir); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (ROW_NAV_KEYS.has(e.key)) {
          e.preventDefault();
          onNavigate(e.key, run.dir);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onSelect(run.dir);
        } else if (e.key === ' ') {
          e.preventDefault();
          onToggleCompare(run.dir);
        }
      }}
      style={{ top, height: ROW_HEIGHT, gridTemplateColumns }}
    >
      <div
        role="cell"
        className="nuclei-runs-row__check"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={compareSelected}
          tabIndex={active ? 0 : -1}
          onCheckedChange={() => onToggleCompare(run.dir)}
          aria-label={`Select ${run.dir} for comparison`}
        />
      </div>
      <div role="cell" title={run.dir} className="nuclei-runs-row__run">
        {formatRunLabel(run.dir, run.manifest.started_at)}
      </div>
      {columns.map((column) => {
        const value = getRunValue(run, column);
        const isStatus = column.key === 'status';
        const isNumeric = isNumericColumn(column);
        return (
          <div
            key={column.key}
            role="cell"
            className="nuclei-runs-row__cell"
            data-numeric={isNumeric}
          >
            {isStatus ? (
              <Badge tone={statusTone}>{formatCell(value, column, 0)}</Badge>
            ) : formatCell(value, column, decimalsByColumn.get(column.key) ?? 0)}
          </div>
        );
      })}
    </div>
  );
}
