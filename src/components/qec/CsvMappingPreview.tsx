import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import {
  applyMapping, bestCollisionKey, DECODER_COLUMN, findCollisions, findPartitionKeys, isFallbackPGuess,
  metadataKeys, splitMetadataKeys, type SinterMapping,
} from '../../types/sinterMapping';
import { toStatsPoint } from '../../types/qecStats';
import { isNotProbability } from '../../lib/qecProbability';
import { formatNoise, formatCount } from '../../lib/qecPlotFormat';
import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';
import { Button, Select } from '../ui';
import { Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table';

const PREVIEW_ROWS = 10;
type Field = 'p' | 'd' | 'rounds' | 'decoder';

const FIELDS: Array<{ field: Field; label: string; short: string }> = [
  { field: 'p', label: 'x-axis: physical error p', short: 'p' },
  { field: 'd', label: 'code distance d', short: 'd' },
  { field: 'rounds', label: 'rounds', short: 'rounds' },
  { field: 'decoder', label: 'decoder', short: 'decoder' },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function fieldSummary(mapping: SinterMapping, field: Field): string {
  const value = mapping[field];
  if (field === 'decoder') return value === DECODER_COLUMN ? 'decoder column' : String(value);
  return value ?? 'none';
}

/**
 * The loaded sinter CSV's json_metadata mapping. After a load it is one line
 * (file, counts, what is mapped) with the editor behind "Edit mapping";
 * anything the person must decide (colliding tasks, unsplit blocks, a guessed
 * x-axis, rejected rows) stays visible above the plot. Changing a control
 * re-plots immediately (store.setCsvMapping).
 */
export function CsvMappingPreview() {
  const colors = useThemeStore((s) => s.colors);
  const csv = useQecCampaignStore((s) => s.csvImport);
  const setMapping = useQecCampaignStore((s) => s.setCsvMapping);
  const [open, setOpen] = useState(false);
  const keys = useMemo(() => (csv ? metadataKeys(csv.rows) : []), [csv]);
  const partitions = useMemo(() => (csv ? findPartitionKeys(csv.rows, csv.mapping) : []), [csv]);
  const notProbability = useMemo(
    () => new Set(csv ? keys.filter((k) => k.numeric && isNotProbability(csv.rows, k.key)).map((k) => k.key) : []),
    [csv, keys],
  );
  const plotted = useQecCampaignStore((s) => s.rowsByStrongId);
  // The store already holds the mapped rows; re-mapping a 100k-row file here would repeat that work.
  const collisions = useMemo(() => (csv ? findCollisions(Object.values(plotted)) : []), [csv, plotted]);
  const collisionKey = useMemo(() => (csv && collisions.length > 0 ? bestCollisionKey(csv.rows, csv.mapping) : null), [csv, collisions]);
  const plottable = useMemo(
    () => Object.values(plotted).filter((r) => toStatsPoint(r).noise !== null).length,
    [plotted],
  );
  if (!csv) return null;

  const { mapping } = csv;
  const note = { margin: '0 0 6px', fontSize: 12, color: colors.warning, lineHeight: 1.45 } as const;
  const merged = Math.max(0, csv.totalDataRows - csv.rejectedRows - csv.rows.length);
  const needsAttention = collisions.length > 0 || partitions.length > 0 || isFallbackPGuess(mapping) || mapping.p === null
    || (mapping.p !== null && notProbability.has(mapping.p));

  const update = (next: SinterMapping) => setMapping(next);
  const mergeAsReplicates = (key: string) => update({
    ...mapping, groupBy: mapping.groupBy.filter((k) => k !== key), mergeKeys: [...(mapping.mergeKeys ?? []), key],
  });
  const splitBy = (key: string) => update({ ...mapping, groupBy: [...mapping.groupBy, key] });
  const toggleGroup = (key: string, on: boolean) => {
    const rest = mapping.groupBy.filter((k) => k !== key);
    update({ ...mapping, groupBy: on ? [...rest, key] : rest });
  };
  const unmerge = (key: string) => update({ ...mapping, mergeKeys: (mapping.mergeKeys ?? []).filter((k) => k !== key) });

  const { varying, constant } = splitMetadataKeys(keys);
  const mappedKeys = new Set<string | null>([mapping.p, mapping.d, mapping.rounds, mapping.decoder, ...(mapping.mergeKeys ?? [])]);
  const groupable = varying.filter((k) => !mappedKeys.has(k.key) && k.key !== 'label');
  const constantChips = constant.filter((k) => k.key !== 'label');

  const select = ({ field, label }: { field: Field; label: string }) => {
    const options = keys.filter((k) => (field === 'decoder' ? !k.numeric || k.key === mapping.decoder : k.numeric));
    return (
      <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: colors.textMuted }}>
        {label}
        <Select
          size="sm"
          aria-label={`Map ${field}`}
          value={mapping[field] ?? ''}
          onChange={(e) => {
            const value = e.target.value === '' ? null : e.target.value;
            update({ ...mapping, [field]: value, ...(field === 'p' ? { pOrigin: 'user' as const } : {}) });
          }}
          style={{ minWidth: 140 }}
        >
          {field !== 'decoder' && <option value="">— none —</option>}
          {field === 'decoder' && <option value={DECODER_COLUMN}>decoder column</option>}
          {options.map((k) => (
            <option key={k.key} value={k.key}>
              {field === 'p' && notProbability.has(k.key) ? `${k.key} (not a probability)` : k.key}
            </option>
          ))}
        </Select>
      </label>
    );
  };

  const countsNameMerge = (mapping.mergeKeys ?? []).length > 0 && plottable < csv.rows.length;
  const counts = [
    `${plural(csv.totalDataRows, 'row')} → ${plural(csv.rows.length, 'task')}`,
    ...(merged > 0 ? [`${plural(merged, 'duplicate strong_id', 'duplicate strong_ids')} summed, as sinter does`] : []),
    ...(csv.rejectedRows > 0 ? [`${csv.rejectedRows.toLocaleString()} rejected (see below)`] : []),
    `${plottable.toLocaleString()} plottable${countsNameMerge ? ` after summing ${mapping.mergeKeys?.join(', ')} replicates` : ''}`,
  ];
  const mapped = FIELDS.map((f) => `${f.short}: ${fieldSummary(mapping, f.field)}`).join(' · ');
  const seriesBy = mapping.groupBy.length > 0 ? ` · series by ${mapping.groupBy.join(', ')}` : '';
  const replicates = (mapping.mergeKeys ?? []).length > 0 && !countsNameMerge ? ` · ${mapping.mergeKeys?.join(', ')} summed` : '';

  return (
    <section
      aria-label="CSV column mapping"
      style={{
        padding: '6px 12px', borderBottom: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans,
        flex: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colors.textMuted, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${counts.join(' · ')} · ${mapped}${seriesBy}${replicates}`}>
          <strong style={{ color: colors.text }}>{csv.sourceName}</strong>
          {` · ${counts.join(' · ')} · ${mapped}${seriesBy}${replicates}`}
        </div>
        <Button
          size="sm" variant="ghost" aria-expanded={open} aria-controls="qec-mapping-editor"
          onClick={() => setOpen((v) => !v)}
          icon={open ? <ChevronDown size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} /> : <ChevronRight size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
        >
          Edit mapping
        </Button>
      </div>

      <div style={{ marginTop: needsAttention || csv.issues.length > 0 ? 6 : 0 }}>
        {collisions.length > 0 && (
          <div role="alert" style={note}>
            {`${plural(collisions.length, 'plotted point is', 'plotted points are')} shared by more than one task `
              + '(same series, d, decoder and p), so curves repeat x values and Λ would treat the colliding tasks as replicates of one point. '}
            {collisionKey && (
              <span style={{ display: 'inline-flex', gap: 6, marginLeft: 4, verticalAlign: 'middle' }}>
                <Button size="sm" onClick={() => mergeAsReplicates(collisionKey)}>{`Merge as replicates (${collisionKey})`}</Button>
                <Button size="sm" onClick={() => splitBy(collisionKey)}>{`Split by ${collisionKey}`}</Button>
              </span>
            )}
          </div>
        )}
        {partitions.length > 0 && (
          <div role="alert" style={note}>
            {`${partitions.map((k) => `"${k.key}" (${k.distinct} values)`).join(', ')} `
              + `${partitions.length === 1 ? 'splits' : 'split'} the tasks into blocks but ${partitions.length === 1 ? 'is' : 'are'} not used `
              + 'to separate series. If the blocks are different experiments (code, noise model), their curves and Λ '
              + 'fits are being pooled. Tick the key under Edit mapping to keep them apart.'}
          </div>
        )}
        {isFallbackPGuess(mapping) && (
          <div style={note}>
            {`p was guessed: "${mapping.p}" is not a conventional name for the noise parameter. Confirm the x-axis under Edit mapping.`}
          </div>
        )}
        {mapping.p !== null && notProbability.has(mapping.p) && (
          <div role="alert" style={note}>
            {`"${mapping.p}" has values outside 0 to 1, so it is not a physical error probability. The x-axis and any threshold read from it would be meaningless; pick the probability column under Edit mapping.`}
          </div>
        )}
        {csv.issues.length > 0 && (
          <ul role="alert" style={{ margin: '0 0 6px', paddingLeft: 16, fontSize: 12, color: colors.warning }}>
            {csv.issues.map((i) => (
              <li key={`${i.line}:${i.message}`}>{i.line > 0 ? `Line ${i.line}: ` : ''}{i.message}</li>
            ))}
          </ul>
        )}
      </div>

      {open && (
        <div id="qec-mapping-editor" style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>{FIELDS.map(select)}</div>
          {(groupable.length > 0 || (mapping.mergeKeys ?? []).length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 12, color: colors.textMuted }}>
              {groupable.length > 0 && <span>Series split by:</span>}
              {groupable.map((k) => (
                <label key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.text }}>
                  <input
                    type="checkbox"
                    style={{ accentColor: colors.accent }}
                    aria-label={`Group series by ${k.key}`}
                    checked={mapping.groupBy.includes(k.key)}
                    onChange={(e) => toggleGroup(k.key, e.target.checked)}
                  />
                  {k.key}
                </label>
              ))}
              {(mapping.mergeKeys ?? []).map((key) => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {`${key} summed as replicates`}
                  <Button size="sm" variant="ghost" onClick={() => unmerge(key)} aria-label={`Stop merging ${key}`}>Unmerge</Button>
                </span>
              ))}
            </div>
          )}
          {constantChips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, fontSize: 11, color: colors.textMuted }}>
              <span>Same in every row:</span>
              {constantChips.map((k) => (
                <span key={k.key} style={{ padding: '1px 6px', borderRadius: 'var(--radius-xs)', border: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontMono }}>
                  {`${k.key} = ${typeof k.sample === 'string' ? k.sample : JSON.stringify(k.sample)}`}
                </span>
              ))}
            </div>
          )}
          <Table label="Mapped rows preview" dense>
            <Thead>
              <Tr>
                {['strong_id', 'shots', 'errors', 'discards', 'p', 'd', 'rounds', 'decoder'].map((h) => (
                  <Th key={h} plain numeric={['shots', 'errors', 'discards', 'p', 'd', 'rounds'].includes(h)}>{h}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {applyMapping(csv.rows.slice(0, PREVIEW_ROWS), mapping).map((r) => {
                const m = r.json_metadata as Record<string, unknown>;
                return (
                  <Tr key={r.strong_id}>
                    <Td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.strong_id}>{r.strong_id}</Td>
                    <Td numeric>{formatCount(r.shots)}</Td>
                    <Td numeric>{formatCount(r.errors)}</Td>
                    <Td numeric>{formatCount(r.discards)}</Td>
                    <Td numeric>{typeof m.p === 'number' ? formatNoise(m.p) : '—'}</Td>
                    <Td numeric>{String(m.d ?? '—')}</Td>
                    <Td numeric>{String(m.rounds ?? '—')}</Td>
                    <Td>{r.decoder}</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
