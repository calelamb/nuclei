const UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const STEP = 1024;

/** "8701" -> "8.5 KB". Whole bytes below 1 KB; one decimal above, none once it reads as 10 or more. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${UNITS[unit]}`;
}

const HASH_PREVIEW_LENGTH = 12;

/** The first characters of a content hash: enough to recognise it, short enough to stay on one line. */
export function shortHash(hash: string): string {
  return hash.length > HASH_PREVIEW_LENGTH ? hash.slice(0, HASH_PREVIEW_LENGTH) : hash;
}
