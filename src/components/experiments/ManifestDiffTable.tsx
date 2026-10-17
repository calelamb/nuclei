import { useThemeStore } from '../../stores/themeStore';
import type { DiffResult, ManifestFieldValue } from '../../services/manifestDiff';
import type { RunRecord } from '../../types/experiment';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';
import { differsFromBaseline, formatDiffValue, splitDiffFields } from './compareDiffModel';
import { formatRunLabel } from './runsTableColumns';
import './experiments.css';

const FIELD_COLUMN_WIDTH = 160;

/**
 * PRD 09 Phase E (E1) — renders `diffManifests`' output: a table of only the
 * DIFFERING short fields (equal-width run columns; values that differ from the
 * first run are highlighted), long values such as a failed run's traceback as
 * full-width blocks below, and the identical fields collapsed behind a
 * `<details>` disclosure.
 */
export function ManifestDiffTable({ diff, runs }: { diff: DiffResult; runs: readonly RunRecord[] }) {
  const colors = useThemeStore((s) => s.colors);
  const cellFont = { fontSize: 11, fontFamily: TYPOGRAPHY.fontMono };
  const { grid, long } = splitDiffFields(diff.differing);
  const runLabel = (run: RunRecord) => formatRunLabel(run.dir, run.manifest.started_at);

  return (
    <div>
      {diff.differing.length === 0 ? (
        <div style={{ color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, padding: '8px 0' }}>
          All manifest fields are identical across the selected runs.
        </div>
      ) : (
        <>
          {grid.length > 0 && (
            <Table label="Differing manifest fields" dense className="nuclei-compare-diff">
              <Thead>
                <Tr>
                  <Th plain style={{ width: FIELD_COLUMN_WIDTH }}>Field</Th>
                  {runs.map((run) => <Th key={run.dir} plain title={run.dir}>{runLabel(run)}</Th>)}
                </Tr>
              </Thead>
              <Tbody>
                {grid.map((field) => (
                  <Tr key={field.key}>
                    <Td muted style={{ fontWeight: 600 }}>{field.key}</Td>
                    {field.values.map((value, i) => (
                      <Td key={runs[i]?.dir ?? i} style={differsFromBaseline(field.values, i) ? { color: colors.accentText } : undefined}>
                        {formatDiffValue(field.key, value)}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          {long.map((field) => (
            <LongField key={field.key} fieldKey={field.key} values={field.values} runs={runs} runLabel={runLabel} />
          ))}
        </>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ color: colors.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: TYPOGRAPHY.fontSans }}>
          {diff.identical.length} identical field{diff.identical.length === 1 ? '' : 's'} (collapsed)
        </summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
          {diff.identical.map((field) => (
            <li key={field.key} style={{ color: colors.textDim, ...cellFont, fontSize: 11, listStyle: 'none' }}>
              {field.key}: {formatDiffValue(field.key, field.value)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function LongField({ fieldKey, values, runs, runLabel }: {
  fieldKey: string;
  values: ReadonlyArray<ManifestFieldValue | undefined>;
  runs: readonly RunRecord[];
  runLabel: (run: RunRecord) => string;
}) {
  const isError = fieldKey === 'error';
  return (
    <div className="nuclei-compare-long" data-field={fieldKey}>
      <div className="nuclei-compare-long__key">{fieldKey}</div>
      {values.map((value, i) => {
        const run = runs[i];
        if (!run || value === undefined || value === null) return null;
        return (
          <div key={run.dir} className="nuclei-compare-long__item">
            <div className="nuclei-compare-long__run" title={run.dir}>{runLabel(run)}</div>
            <pre className="nuclei-compare-long__value" data-tone={isError ? 'error' : undefined}>{String(value)}</pre>
          </div>
        );
      })}
    </div>
  );
}
