import { useThemeStore } from '../../stores/themeStore';
import { getRunValue, type RunColumn } from './runsTableColumns';
import type { RunRecord, RunStatus } from '../../types/experiment';

export const ROW_HEIGHT = 30;

const STATUS_COLOR_KEY: Record<RunStatus, 'success' | 'error' | 'warning' | 'textDim'> = {
  complete: 'success',
  failed: 'error',
  running: 'warning',
  stale: 'textDim',
};

function formatCell(value: number | string | boolean | null, column: RunColumn): string {
  if (value === null) return '—';
  if (column.key === 'duration_ms') return `${(value as number).toLocaleString()}`;
  if (column.key === 'seed_honored') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  return String(value);
}

interface RunsTableRowProps {
  run: RunRecord;
  columns: RunColumn[];
  gridTemplateColumns: string;
  top: number;
  onSelect(dir: string): void;
}

/** One virtualized, absolutely-positioned row in `RunsTable`. */
export function RunsTableRow({ run, columns, gridTemplateColumns, top, onSelect }: RunsTableRowProps) {
  const colors = useThemeStore((s) => s.colors);
  const statusKey = STATUS_COLOR_KEY[run.manifest.status];

  return (
    <div
      role="row"
      onClick={() => onSelect(run.dir)}
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        display: 'grid',
        gridTemplateColumns,
        alignItems: 'center',
        borderBottom: `1px solid ${colors.border}`,
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: "'Fira Code', monospace",
        color: colors.text,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div role="cell" style={{ padding: '0 8px', color: colors.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {run.dir}
      </div>
      {columns.map((column) => {
        const value = getRunValue(run, column);
        const isStatus = column.key === 'status';
        return (
          <div
            key={column.key}
            role="cell"
            style={{
              padding: '0 8px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: isStatus ? colors[statusKey] : colors.text,
              fontWeight: isStatus ? 600 : 400,
            }}
          >
            {formatCell(value, column)}
          </div>
        );
      })}
    </div>
  );
}
