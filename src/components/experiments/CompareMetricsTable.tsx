import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';
import type { RunRecord } from '../../types/experiment';

/**
 * PRD 09 Phase E (E1) — runs (rows) x metrics (columns), derived + user
 * metrics together (both already merged into `RunRecord.metrics` by the
 * runner — see `experimentRunner.ts`'s `computeDerivedMetrics` + user
 * `record_metric` merge). Metric columns are numeric: right-aligned, one
 * fixed four-decimal precision so neighbouring runs line up.
 */
export function CompareMetricsTable({ runs }: { runs: readonly RunRecord[] }) {
  const colors = useThemeStore((s) => s.colors);
  const metricNames = [...new Set(runs.flatMap((r) => Object.keys(r.metrics)))].sort();

  if (metricNames.length === 0) {
    return (
      <div style={{ color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, padding: '8px 0' }}>
        No metrics recorded for the selected runs.
      </div>
    );
  }

  return (
    <Table label="Metrics by run" dense>
      <Thead>
        <Tr>
          <Th plain>Run</Th>
          {metricNames.map((name) => <Th key={name} numeric plain>{name}</Th>)}
        </Tr>
      </Thead>
      <Tbody>
        {runs.map((run) => (
          <Tr key={run.dir}>
            <Td muted>{run.dir}</Td>
            {metricNames.map((name) => {
              const value = run.metrics[name];
              return <Td key={name} numeric>{value === undefined ? '—' : value.toFixed(4)}</Td>;
            })}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
