import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import {
  applyMapping, DECODER_COLUMN, findCollisions, findPartitionKeys, isFallbackPGuess, metadataKeys,
} from '../../types/sinterMapping';
import { toStatsPoint } from '../../types/qecStats';

const PREVIEW_ROWS = 10;
type Field = 'p' | 'd' | 'rounds' | 'decoder';

const FIELDS: Array<{ field: Field; label: string }> = [
  { field: 'p', label: 'x-axis: physical error p' },
  { field: 'd', label: 'code distance d' },
  { field: 'rounds', label: 'rounds' },
  { field: 'decoder', label: 'decoder' },
];

/**
 * Explicit, editable mapping of a loaded sinter CSV's json_metadata keys to
 * the plot's fields, with a 10-row preview of what each row will plot as.
 * Changing a select re-plots immediately (store.setCsvMapping).
 */
export function CsvMappingPreview() {
  const colors = useThemeStore((s) => s.colors);
  const csv = useQecCampaignStore((s) => s.csvImport);
  const setMapping = useQecCampaignStore((s) => s.setCsvMapping);
  const keys = useMemo(() => (csv ? metadataKeys(csv.rows) : []), [csv]);
  const mapped = useMemo(
    () => (csv ? applyMapping(csv.rows.slice(0, PREVIEW_ROWS), csv.mapping) : []),
    [csv],
  );
  const collisions = useMemo(
    () => (csv ? findCollisions(applyMapping(csv.rows, csv.mapping)) : []),
    [csv],
  );
  const partitions = useMemo(() => (csv ? findPartitionKeys(csv.rows, csv.mapping) : []), [csv]);
  const plotted = useQecCampaignStore((s) => s.rowsByStrongId);
  const plottable = useMemo(
    () => Object.values(plotted).filter((r) => toStatsPoint(r).noise !== null).length,
    [plotted],
  );
  if (!csv) return null;

  const select = (field: Field, label: string) => (
    <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10.5, color: colors.textDim }}>
      {label}
      <select
        aria-label={`Map ${field}`}
        value={csv.mapping[field] ?? ''}
        onChange={(e) => setMapping({ ...csv.mapping, [field]: e.target.value === '' ? null : e.target.value })}
        style={{
          background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
          borderRadius: 4, fontSize: 11.5, padding: '3px 4px', minWidth: 120,
        }}
      >
        {field !== 'decoder' && <option value="">— none —</option>}
        {field === 'decoder' && <option value={DECODER_COLUMN}>decoder column</option>}
        {keys
          .filter((k) => field === 'decoder' || k.numeric)
          .map((k) => <option key={k.key} value={k.key}>{k.key}</option>)}
      </select>
    </label>
  );

  const mappedKeys = new Set<string | null>([csv.mapping.p, csv.mapping.d, csv.mapping.rounds, csv.mapping.decoder]);
  const groupable = keys.filter((k) => !mappedKeys.has(k.key) && k.key !== 'label');
  const toggleGroup = (key: string, on: boolean) => {
    const rest = csv.mapping.groupBy.filter((k) => k !== key);
    setMapping({ ...csv.mapping, groupBy: on ? [...rest, key] : rest });
  };
  const note = { margin: '0 0 6px', fontSize: 11, color: colors.warning } as const;

  const th = { textAlign: 'left' as const, padding: '2px 8px', color: colors.textDim, fontWeight: 500 };
  const td = { padding: '2px 8px', color: colors.text, fontFamily: "'Fira Code', monospace" };
  return (
    <section
      aria-label="CSV column mapping"
      style={{
        padding: '8px 12px', borderBottom: `1px solid ${colors.border}`, fontFamily: "'Geist Sans', sans-serif",
        maxHeight: 220, overflow: 'auto',
      }}
    >
      <div style={{ fontSize: 11.5, color: colors.textMuted, marginBottom: 6 }}>
        <strong style={{ color: colors.text }}>{csv.sourceName}</strong>
        {' · '}{csv.totalDataRows} rows → {csv.rows.length} tasks
        {csv.totalDataRows > csv.rows.length ? ' (duplicate strong_ids summed, as sinter does)' : ''}
        {' · '}{plottable} plottable
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        {FIELDS.map((f) => select(f.field, f.label))}
      </div>
      {groupable.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 11, color: colors.textDim }}>
          <span>Series split by:</span>
          {groupable.map((k) => (
            <label key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.textMuted }}>
              <input
                type="checkbox"
                aria-label={`Group series by ${k.key}`}
                checked={csv.mapping.groupBy.includes(k.key)}
                onChange={(e) => toggleGroup(k.key, e.target.checked)}
              />
              {k.key}
            </label>
          ))}
        </div>
      )}
      {collisions.length > 0 && (
        <div role="alert" style={note}>
          {`${collisions.length} plotted ${collisions.length === 1 ? 'point is' : 'points are'} shared by more than one task `
            + '(same series, d, decoder and p), so curves repeat x values and Λ treats the colliding tasks '
            + 'as replicates of one point. Tick a key above (e.g. basis, noise model) to split them.'}
        </div>
      )}
      {partitions.length > 0 && (
        <div role="alert" style={note}>
          {`${partitions.map((k) => `"${k.key}" (${k.distinct} values)`).join(', ')} `
            + `${partitions.length === 1 ? 'splits' : 'split'} the tasks into blocks but ${partitions.length === 1 ? 'is' : 'are'} not used `
            + 'to separate series. If the blocks are different experiments (code, noise model), their curves and Λ '
            + 'fits are being pooled. Tick the key above to keep them apart.'}
        </div>
      )}
      {isFallbackPGuess(csv.mapping) && (
        <div style={note}>
          {`p was guessed: "${csv.mapping.p}" is not a conventional name for the noise parameter. Confirm the x-axis.`}
        </div>
      )}
      {csv.issues.length > 0 && (
        <ul role="alert" style={{ margin: '0 0 6px', paddingLeft: 16, fontSize: 11, color: colors.warning }}>
          {csv.issues.map((i) => (
            <li key={`${i.line}:${i.message}`}>{i.line > 0 ? `Line ${i.line}: ` : ''}{i.message}</li>
          ))}
        </ul>
      )}
      <table style={{ borderCollapse: 'collapse', fontSize: 10.5 }}>
        <thead>
          <tr>
            {['strong_id', 'shots', 'errors', 'discards', 'p', 'd', 'rounds', 'decoder'].map((h) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mapped.map((r) => {
            const m = r.json_metadata as Record<string, unknown>;
            return (
              <tr key={r.strong_id}>
                <td style={td}>{r.strong_id.slice(0, 8)}</td>
                <td style={td}>{r.shots}</td>
                <td style={td}>{r.errors}</td>
                <td style={td}>{r.discards}</td>
                <td style={td}>{String(m.p ?? '—')}</td>
                <td style={td}>{String(m.d ?? '—')}</td>
                <td style={td}>{String(m.rounds ?? '—')}</td>
                <td style={td}>{r.decoder}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
