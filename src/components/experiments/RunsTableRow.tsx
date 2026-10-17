import { useThemeStore } from '../../stores/themeStore';
import { formatRunLabel, isNumericColumn, getRunValue, type RunColumn } from './runsTableColumns';
import type { RunRecord, RunStatus } from '../../types/experiment';
import { activateOnKey } from '../../lib/a11y';

export const ROW_HEIGHT = 30;

const STATUS_COLOR_KEY: Record<RunStatus, 'success' | 'error' | 'warning' | 'textDim'> = {
  complete: 'success',
  failed: 'error',
  running: 'warning',
  stale: 'textDim',
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
  onSelect(dir: string): void;
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
  onSelect,
  onToggleCompare,
}: RunsTableRowProps) {
  const colors = useThemeStore((s) => s.colors);
  const statusKey = STATUS_COLOR_KEY[run.manifest.status];

  return (
    <div
      role="row"
      className="nuclei-runs-row"
      data-run-dir={run.dir}
      data-checked={compareSelected}
      tabIndex={0}
      onClick={() => onSelect(run.dir)}
      onKeyDown={activateOnKey(() => onSelect(run.dir))}
      style={{ top, height: ROW_HEIGHT, gridTemplateColumns }}
    >
      <div
        role="cell"
        className="nuclei-runs-row__check"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={compareSelected}
          onChange={() => onToggleCompare(run.dir)}
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
            style={isStatus ? { color: colors[statusKey], fontWeight: 600 } : undefined}
          >
            {isStatus ? (
              <span className="nuclei-runs-row__status" style={{ background: `color-mix(in srgb, ${colors[statusKey]} 12%, transparent)` }}>
                {formatCell(value, column, 0)}
              </span>
            ) : formatCell(value, column, decimalsByColumn.get(column.key) ?? 0)}
          </div>
        );
      })}
    </div>
  );
}
