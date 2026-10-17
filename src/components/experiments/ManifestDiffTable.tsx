import { useThemeStore } from '../../stores/themeStore';
import type { DiffResult, ManifestFieldValue } from '../../services/manifestDiff';
import type { RunRecord } from '../../types/experiment';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';

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
  const cellFont = { fontSize: 11, fontFamily: TYPOGRAPHY.fontMono };

  return (
    <div>
      {diff.differing.length === 0 ? (
        <div style={{ color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, padding: '8px 0' }}>
          All manifest fields are identical across the selected runs.
        </div>
      ) : (
        <Table label="Differing manifest fields" dense>
          <Thead>
            <Tr>
              <Th plain>Field</Th>
              {runs.map((run) => <Th key={run.dir} plain>{run.dir}</Th>)}
            </Tr>
          </Thead>
          <Tbody>
            {diff.differing.map((field) => (
              <Tr key={field.key}>
                <Td muted style={{ fontWeight: 600 }}>{field.key}</Td>
                {field.values.map((value, i) => (
                  <Td key={runs[i]?.dir ?? i} style={{ color: colors.accentText }}>{formatValue(value)}</Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ color: colors.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: TYPOGRAPHY.fontSans }}>
          {diff.identical.length} identical field{diff.identical.length === 1 ? '' : 's'} (collapsed)
        </summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
          {diff.identical.map((field) => (
            <li key={field.key} style={{ color: colors.textDim, ...cellFont, fontSize: 11, listStyle: 'none' }}>
              {field.key}: {formatValue(field.value)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
