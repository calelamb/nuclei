import { DECODER_COLUMN, type SinterMapping } from '../types/sinterMapping';

/** "p = q" for a column that differs from the field name, "rounds unmapped" for none; a column named like its field needs no mention. */
const field = (name: string, key: string | null): string | null => {
  if (key === null) return `${name} unmapped`;
  return key === name ? null : `${name} = ${key}`;
};

/**
 * One-line, honest description of the current CSV column mapping, one notation
 * throughout: only what departs from the defaults is listed (columns not named
 * after their field, unmapped fields, splits, replicate sums).
 */
export function describeMapping(mapping: SinterMapping): string {
  const parts = [
    field('p', mapping.p),
    field('d', mapping.d),
    field('rounds', mapping.rounds),
    mapping.decoder === DECODER_COLUMN ? null : `decoder = ${mapping.decoder}`,
  ].filter((part): part is string => part !== null);
  if (mapping.groupBy.length > 0) parts.push(`split by ${mapping.groupBy.join(', ')}`);
  const merged = mapping.mergeKeys ?? [];
  if (merged.length > 0) parts.push(`${merged.join(', ')} summed as replicates`);
  return parts.length > 0 ? parts.join(' · ') : 'columns matched by name';
}

const noun = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export interface CountsInput {
  totalDataRows: number;
  /** Distinct strong_ids in the file, before any replicate merge. */
  tasks: number;
  /** Points on the plot, after replicate merging. */
  points: number;
  mergeKeys: readonly string[];
}

/** "3,600 rows · 3,600 tasks · 720 points after summing seed replicates". */
export function describeCounts({ totalDataRows, tasks, points, mergeKeys }: CountsInput): string {
  const base = `${noun(totalDataRows, 'row', 'rows')} · ${noun(tasks, 'task', 'tasks')}`;
  if (mergeKeys.length === 0 || points >= tasks) return base;
  return `${base} · ${noun(points, 'point', 'points')} after summing ${mergeKeys.join(', ')} replicates`;
}
