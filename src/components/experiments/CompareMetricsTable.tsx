import { useThemeStore } from '../../stores/themeStore';
import type { RunRecord } from '../../types/experiment';

/**
 * PRD 09 Phase E (E1) — runs (rows) x metrics (columns), derived + user
 * metrics together (both already merged into `RunRecord.metrics` by the
 * runner — see `experimentRunner.ts`'s `computeDerivedMetrics` + user
 * `record_metric` merge).
 */
export function CompareMetricsTable({ runs }: { runs: readonly RunRecord[] }) {
  const colors = useThemeStore((s) => s.colors);
  const metricNames = [...new Set(runs.flatMap((r) => Object.keys(r.metrics)))].sort();
  const cellFont = { fontSize: 11, fontFamily: "'Fira Code', monospace" };

  if (metricNames.length === 0) {
    return (
      <div style={{ color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif", padding: '6px 0' }}>
        No metrics recorded for the selected runs.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', ...cellFont }}>
        <thead>
          <tr>
            <th style={headerCellStyle(colors)}>Run</th>
            {metricNames.map((name) => <th key={name} style={headerCellStyle(colors)}>{name}</th>)}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.dir}>
              <td style={{ ...bodyCellStyle(colors), color: colors.textDim }}>{run.dir}</td>
              {metricNames.map((name) => {
                const value = run.metrics[name];
                return (
                  <td key={name} style={{ ...bodyCellStyle(colors), color: colors.text }}>
                    {value === undefined ? '—' : value.toFixed(4)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function headerCellStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return {
    textAlign: 'left' as const,
    padding: '4px 8px',
    color: colors.textDim,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    borderBottom: `1px solid ${colors.border}`,
  };
}

function bodyCellStyle(colors: ReturnType<typeof useThemeStore.getState>['colors']) {
  return {
    padding: '4px 8px',
    borderBottom: `1px solid ${colors.border}`,
    whiteSpace: 'nowrap' as const,
  };
}
