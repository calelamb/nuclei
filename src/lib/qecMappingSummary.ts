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
  return parts.join(' · ');
}
