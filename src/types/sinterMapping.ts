import type { QecCampaignStatsRow } from './qec';

/**
 * Explicit mapping from a sinter CSV's free-form json_metadata keys to the
 * four fields the threshold plot needs. sinter metadata has no schema, so the
 * guess is shown to the user and stays editable; applyMapping re-expresses
 * rows under the canonical keys (p, d, label, ...) that qecStats reads.
 */

/** Sentinel for "use the CSV's decoder column". */
export const DECODER_COLUMN = '__decoder_column__';

export interface SinterMapping {
  /** metadata key for the x-axis noise parameter, or null for none. */
  p: string | null;
  d: string | null;
  rounds: string | null;
  /** metadata key, or DECODER_COLUMN. */
  decoder: string;
}

export interface MetadataKeyInfo {
  key: string;
  /** Every row that has the key holds a number (or numeric string). */
  numeric: boolean;
  distinct: number;
  sample: unknown;
}

const P_NAMES = ['p', 'noise', 'physical_error_rate', 'physical_error', 'error_rate', 'noise_strength', 'phys_err', 'p_phys'];
const D_NAMES = ['d', 'distance', 'code_distance', 'dist'];
const R_NAMES = ['r', 'rounds', 'num_rounds', 'n_rounds', 'round'];
const DECODER_NAMES = ['decoder', 'decoder_name'];

function meta(row: QecCampaignStatsRow): Record<string, unknown> {
  const m = row.json_metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Keys present in any row's metadata, sorted, with type info for the UI. */
export function metadataKeys(rows: readonly QecCampaignStatsRow[]): MetadataKeyInfo[] {
  const acc = new Map<string, { numeric: boolean; values: Set<string>; sample: unknown }>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(meta(row))) {
      const e = acc.get(key) ?? { numeric: true, values: new Set<string>(), sample: value };
      e.numeric = e.numeric && asNumber(value) !== null;
      e.values.add(JSON.stringify(value));
      acc.set(key, e);
    }
  }
  return [...acc.entries()]
    .map(([key, e]) => ({ key, numeric: e.numeric, distinct: e.values.size, sample: e.sample }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function pick(keys: readonly MetadataKeyInfo[], names: readonly string[], numericOnly: boolean): string | null {
  for (const name of names) {
    const hit = keys.find((k) => k.key.toLowerCase() === name && (!numericOnly || k.numeric));
    if (hit) return hit.key;
  }
  return null;
}

/** Best-guess mapping from conventional key names; never throws. */
export function guessMapping(rows: readonly QecCampaignStatsRow[]): SinterMapping {
  const keys = metadataKeys(rows);
  const d = pick(keys, D_NAMES, true);
  const rounds = pick(keys, R_NAMES, true);
  let p = pick(keys, P_NAMES, true);
  if (p === null) {
    p = keys.find((k) => k.numeric && k.distinct > 1 && k.key !== d && k.key !== rounds)?.key ?? null;
  }
  return { p, d, rounds, decoder: pick(keys, DECODER_NAMES, false) ?? DECODER_COLUMN };
}

const DEFAULT_LABEL = 'stats';

/** True when some distance has more than one distinct rounds value. */
function roundsVaryAtFixedDistance(rows: readonly QecCampaignStatsRow[], m: SinterMapping): boolean {
  if (!m.rounds) return false;
  const seen = new Map<string, Set<number>>();
  for (const row of rows) {
    const md = meta(row);
    const r = asNumber(md[m.rounds]);
    if (r === null) continue;
    const dKey = m.d ? String(asNumber(md[m.d])) : '';
    const set = seen.get(dKey) ?? new Set<number>();
    set.add(r);
    seen.set(dKey, set);
  }
  return [...seen.values()].some((s) => s.size > 1);
}

function withoutKey(md: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(md).filter(([k]) => k !== key));
}

/** Re-express rows under the canonical keys the plot reads. Pure: returns new
 * rows and leaves the input untouched. Rows whose p is missing/non-numeric
 * lose `p` and are simply not plotted. */
export function applyMapping(rows: readonly QecCampaignStatsRow[], mapping: SinterMapping): QecCampaignStatsRow[] {
  const splitByRounds = roundsVaryAtFixedDistance(rows, mapping);
  return rows.map((row) => {
    const md = meta(row);
    let next: Record<string, unknown> = { ...md };
    const p = mapping.p ? asNumber(md[mapping.p]) : null;
    const d = mapping.d ? asNumber(md[mapping.d]) : null;
    const r = mapping.rounds ? asNumber(md[mapping.rounds]) : null;
    next = p !== null ? { ...next, p } : withoutKey(next, 'p');
    next = d !== null ? { ...next, d } : withoutKey(next, 'd');
    if (r !== null) next = { ...next, rounds: r };
    const baseLabel = typeof md.label === 'string' ? md.label : DEFAULT_LABEL;
    next = { ...next, label: splitByRounds && r !== null ? `${baseLabel} r=${r}` : baseLabel };
    const decoderValue = mapping.decoder === DECODER_COLUMN ? row.decoder : md[mapping.decoder];
    return {
      ...row,
      decoder: typeof decoderValue === 'string' ? decoderValue : row.decoder,
      json_metadata: next,
    };
  });
}
