import { MAPPED_KEY } from '../types/sinterMapping';

/**
 * Number of QEC rounds per shot, or null. Rows re-expressed by the user's CSV
 * mapping carry their rounds under the canonical `rounds` key only (so
 * "rounds: none" really means unknown); raw sinter/campaign rows use `r` or
 * `rounds`.
 */
export function roundsFromMetadata(meta: unknown): number | null {
  if (typeof meta !== 'object' || meta === null) return null;
  const m = meta as Record<string, unknown>;
  const keys = MAPPED_KEY in m ? ['rounds'] : ['r', 'rounds'];
  for (const k of keys) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}
