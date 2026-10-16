/** Number of QEC rounds per shot from sinter metadata (`r` or `rounds`), or null. */
export function roundsFromMetadata(meta: unknown): number | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const m = meta as Record<string, unknown>;
  for (const k of ['r', 'rounds']) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}
