import { DECODER_COLUMN, type SinterMapping } from '../types/sinterMapping';

const field = (name: string, key: string | null): string => (key === null ? `${name} unmapped` : `${name} = ${key}`);

/** One-line, honest description of the current CSV column mapping. */
export function describeMapping(mapping: SinterMapping): string {
  const parts = [
    field('p', mapping.p),
    field('d', mapping.d),
    field('rounds', mapping.rounds),
    mapping.decoder === DECODER_COLUMN ? 'series by decoder column' : `series by ${mapping.decoder}`,
  ];
  if (mapping.groupBy.length > 0) parts.push(`split by ${mapping.groupBy.join(', ')}`);
  const merged = mapping.mergeKeys ?? [];
  if (merged.length > 0) parts.push(`${merged.join(', ')} summed as replicates`);
  return parts.join(' · ');
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
