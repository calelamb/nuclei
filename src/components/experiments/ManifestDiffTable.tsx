import { useThemeStore } from '../../stores/themeStore';
import type { DiffResult, ManifestFieldValue } from '../../services/manifestDiff';
import type { RunRecord } from '../../types/experiment';

function formatValue(v: ManifestFieldValue | undefined): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  return String(v);
}

/**
 * PRD 09 Phase E (E1) — renders `diffManifests`' output: a small table of
 * only the DIFFERING fields (one column per selected run, highlighted),
 * with the identical fields collapsed behind a `<details>` disclosure so a
 * long manifest doesn't drown the interesting differences.
 */
export function ManifestDiffTable({ diff, runs }: { diff: DiffResult; runs: readonly RunRecord[] }) {
  const colors = useThemeStore((s) => s.colors);
  const cellFont = { fontSize: 11, fontFamily: "'Fira Code', monospace" };

  return (
    <div>
      {diff.differing.length === 0 ? (
        <div style={{ color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif", padding: '6px 0' }}>
          All manifest fields are identical across the selected runs.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', ...cellFont }}>
            <thead>
              <tr>
                <th style={headerCellStyle(colors)}>Field</th>
                {runs.map((run) => (
                  <th key={run.dir} style={headerCellStyle(colors)}>{run.dir}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diff.differing.map((field) => (
                <tr key={field.key}>
                  <td style={{ ...bodyCellStyle(colors), color: colors.textDim, fontWeight: 600 }}>{field.key}</td>
                  {field.values.map((value, i) => (
                    <td key={runs[i]?.dir ?? i} style={{ ...bodyCellStyle(colors), color: colors.accent }}>
                      {formatValue(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ color: colors.textDim, fontSize: 10, cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif" }}>
          {diff.identical.length} identical field{diff.identical.length === 1 ? '' : 's'} (collapsed)
        </summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
          {diff.identical.map((field) => (
            <li key={field.key} style={{ color: colors.textDim, ...cellFont, fontSize: 10, listStyle: 'none' }}>
              {field.key}: {formatValue(field.value)}
            </li>
          ))}
        </ul>
      </details>
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
