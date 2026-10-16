import type { QecCampaignStatsRow } from './qec';

/**
 * Explicit mapping from a sinter CSV's free-form json_metadata keys to the
 * four fields the threshold plot needs. sinter metadata has no schema, so the
 * guess is shown to the user and stays editable; applyMapping re-expresses
 * rows under the canonical keys (p, d, label, ...) that qecStats reads.
 */

/** Reserved json_metadata key set by applyMapping on every mapped row. Its
 * presence means "identity comes from the user's mapping, not from guessing
 * at other metadata keys" (see qecExperiments.ts). */
export const MAPPED_KEY = '__nuclei_mapping';

/** Sentinel for "use the CSV's decoder column". */
export const DECODER_COLUMN = '__decoder_column__';

export interface SinterMapping {
  /** metadata key for the x-axis noise parameter, or null for none. */
  p: string | null;
  d: string | null;
  rounds: string | null;
  /** metadata key, or DECODER_COLUMN. */
  decoder: string;
  /** Extra metadata keys that split tasks into separate series (and separate
   * Λ fits), e.g. basis / noise model. Folded into the decoder string so that
   * both the series key and the Λ fit keep the groups apart. */
  groupBy: string[];
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

/** True when p was chosen by the "first varying numeric key" fallback rather
 * than a conventional name, so the UI can flag it as a low-confidence guess. */
export function isFallbackPGuess(mapping: SinterMapping): boolean {
  return mapping.p !== null && !P_NAMES.includes(mapping.p.toLowerCase());
}

/** Total tasks beyond the first at each (series, d, decoder, p) cell. */
function excess(rows: readonly QecCampaignStatsRow[], mapping: SinterMapping): number {
  return findCollisions(applyMapping(rows, mapping)).reduce((n, c) => n + c.count - 1, 0);
}

export interface PartitionKey {
  key: string;
  /** Distinct values of the key across tasks. */
  distinct: number;
}

const valueOf = (row: QecCampaignStatsRow, key: string): string => JSON.stringify(meta(row)[key] ?? null);

/** True when `key` and `axis` determine each other (one value of one per
 * value of the other), e.g. a qubit count that is a function of d. */
function isBijective(rows: readonly QecCampaignStatsRow[], key: string, axis: string): boolean {
  const forward = new Map<string, Set<string>>();
  const backward = new Map<string, Set<string>>();
  for (const row of rows) {
    const k = valueOf(row, key);
    const a = valueOf(row, axis);
    forward.set(k, (forward.get(k) ?? new Set<string>()).add(a));
    backward.set(a, (backward.get(a) ?? new Set<string>()).add(k));
  }
  return [...forward.values()].every((s) => s.size === 1) && [...backward.values()].every((s) => s.size === 1);
}

/**
 * Unmapped, non-grouped metadata keys that split the tasks into blocks (2 to
 * n-1 distinct values, unlike a per-task seed that has n) without merely
 * restating d, p or rounds. Such a key can separate experiments whose grids
 * do not overlap, so no (d, p) collision ever reveals it; left alone, the
 * blocks would be joined into one curve and one Λ fit. The guess groups by
 * these keys; anything still returned here must be shown to the user.
 */
export function findPartitionKeys(rows: readonly QecCampaignStatsRow[], mapping: SinterMapping): PartitionKey[] {
  const taken = new Set<string | null>([mapping.p, mapping.d, mapping.rounds, mapping.decoder, 'label', ...mapping.groupBy]);
  const axes = [mapping.d, mapping.p, mapping.rounds].filter((a): a is string => a !== null);
  return metadataKeys(rows)
    .filter((k) => !taken.has(k.key))
    .filter((k) => k.distinct >= 2 && k.distinct < rows.length)
    .filter((k) => !axes.some((a) => isBijective(rows, k.key, a)))
    .map((k) => ({ key: k.key, distinct: k.distinct }));
}

/** Greedily add unmapped varying keys to groupBy until no two tasks share a
 * plotted point (or no key helps). Fewer-valued keys win ties. */
function autoGroupBy(
  rows: readonly QecCampaignStatsRow[], base: SinterMapping, keys: readonly MetadataKeyInfo[],
): string[] {
  const taken = new Set([base.p, base.d, base.rounds, base.decoder, 'label']);
  const candidates = keys.filter((k) => k.distinct > 1 && !taken.has(k.key)).sort((a, b) => a.distinct - b.distinct);
  let groupBy: string[] = [];
  let current = excess(rows, base);
  while (current > 0) {
    let best: { key: string; score: number } | null = null;
    for (const c of candidates) {
      if (groupBy.includes(c.key)) continue;
      const score = excess(rows, { ...base, groupBy: [...groupBy, c.key] });
      if (score < current && (best === null || score < best.score)) best = { key: c.key, score };
    }
    if (best === null) break;
    groupBy = [...groupBy, best.key];
    current = best.score;
  }
  return groupBy;
}

/** Collision-removing keys first, then any remaining block-partitioning keys. */
function guessGroupBy(
  rows: readonly QecCampaignStatsRow[], base: SinterMapping, keys: readonly MetadataKeyInfo[],
): string[] {
  const collision = autoGroupBy(rows, base, keys);
  const partition = findPartitionKeys(rows, { ...base, groupBy: collision }).map((k) => k.key);
  return [...collision, ...partition];
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
  const base: SinterMapping = {
    p, d, rounds, decoder: pick(keys, DECODER_NAMES, false) ?? DECODER_COLUMN, groupBy: [],
  };
  return { ...base, groupBy: guessGroupBy(rows, base, keys) };
}

const DEFAULT_LABEL = 'stats';

function withoutKey(md: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(md).filter(([k]) => k !== key));
}

function groupSuffix(md: Record<string, unknown>, groupBy: readonly string[], decoder: string): string {
  const parts = groupBy
    .filter((k) => Object.hasOwn(md, k))
    .map((k) => `${k}=${typeof md[k] === 'string' ? md[k] : JSON.stringify(md[k])}`);
  return parts.length > 0 ? `${decoder} [${parts.join(', ')}]` : decoder;
}

/** Re-express rows under the canonical keys the plot reads. Pure: returns new
 * rows and leaves the input untouched. Rows whose p is missing/non-numeric
 * lose `p` and are simply not plotted. */
export function applyMapping(rows: readonly QecCampaignStatsRow[], mapping: SinterMapping): QecCampaignStatsRow[] {
  return rows.map((row) => {
    const md = meta(row);
    let next: Record<string, unknown> = { ...md };
    const p = mapping.p ? asNumber(md[mapping.p]) : null;
    const d = mapping.d ? asNumber(md[mapping.d]) : null;
    const r = mapping.rounds ? asNumber(md[mapping.rounds]) : null;
    next = p !== null ? { ...next, p } : withoutKey(next, 'p');
    next = d !== null ? { ...next, d } : withoutKey(next, 'd');
    const baseLabel = typeof md.label === 'string' ? md.label : DEFAULT_LABEL;
    next = r !== null ? { ...next, rounds: r } : withoutKey(next, 'rounds');
    // The mapping is the single definition of experiment identity: the group-by
    // keys live in `decoder`, rounds in `rounds`. qecExperiments reads this
    // marker and pools only by (decoder, label, rounds scheme).
    next = { ...next, label: baseLabel, [MAPPED_KEY]: { groupBy: [...mapping.groupBy] } };
    const decoderValue = mapping.decoder === DECODER_COLUMN ? row.decoder : md[mapping.decoder];
    const baseDecoder = typeof decoderValue === 'string' ? decoderValue : row.decoder;
    return {
      ...row,
      decoder: groupSuffix(md, mapping.groupBy, baseDecoder),
      json_metadata: next,
    };
  });
}

export interface Collision {
  label: string;
  d: number | null;
  decoder: string;
  p: number;
  rounds: number | null;
  /** Tasks (distinct strong_ids) landing on this one plotted point. */
  count: number;
}

/** Cells of the plot (series × d × decoder × p) that more than one task maps
 * to. Run on applyMapping output. Any hit means a curve has repeated x values
 * and Λ would treat the colliding tasks as replicates of one point. */
export function findCollisions(mapped: readonly QecCampaignStatsRow[]): Collision[] {
  const cells = new Map<string, Collision>();
  for (const row of mapped) {
    const md = meta(row);
    const p = asNumber(md.p);
    if (p === null) continue;
    const label = typeof md.label === 'string' ? md.label : DEFAULT_LABEL;
    const d = asNumber(md.d);
    const rounds = asNumber(md.rounds);
    const key = JSON.stringify([label, d, row.decoder, p, rounds]);
    const hit = cells.get(key);
    cells.set(key, hit ? { ...hit, count: hit.count + 1 } : { label, d, decoder: row.decoder, p, rounds, count: 1 });
  }
  return [...cells.values()].filter((c) => c.count > 1);
}
