import type { DiffField, ManifestFieldValue } from '../../services/manifestDiff';
import { formatLocalDateTime } from './runDetailFormat';

/** Values longer than this (stack traces, hashes) leave the grid so columns stay readable. */
export const LONG_VALUE_CHARS = 48;

export interface SplitDiffFields {
  /** Short fields, rendered as grid rows. */
  grid: DiffField[];
  /** Fields with at least one long string value, rendered as full-width blocks. */
  long: DiffField[];
}

function isLong(value: ManifestFieldValue | undefined): boolean {
  return typeof value === 'string' && value.length > LONG_VALUE_CHARS;
}

export function splitDiffFields(fields: readonly DiffField[]): SplitDiffFields {
  const grid: DiffField[] = [];
  const long: DiffField[] = [];
  for (const field of fields) {
    (field.values.some(isLong) ? long : grid).push(field);
  }
  return { grid, long };
}

/** Only values that differ from the first run get the highlight; the first run is the baseline. */
export function differsFromBaseline(values: ReadonlyArray<ManifestFieldValue | undefined>, index: number): boolean {
  return index > 0 && values[index] !== values[0];
}

export function formatDiffValue(key: string, value: ManifestFieldValue | undefined): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (key === 'started_at' && typeof value === 'string') return formatLocalDateTime(value);
  return String(value);
}
