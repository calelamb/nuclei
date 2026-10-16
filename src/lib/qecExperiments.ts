/**
 * Experiment identity for sinter stats rows.
 *
 * Rows may only be pooled into one curve or one Λ fit when they belong to the
 * same experiment: same decoder and same json_metadata in every field except
 * the sweep axes (`d`, `p`) and the round count. Rounds are handled
 * separately because they usually scale with distance (r = d, r = 3d): within
 * a group we key on the ratio r/d when that explains the rounds (fewer
 * distinct ratios than distinct round counts), otherwise on the fixed r.
 * Pooling r = d with r = 3d rows (the bug this module fixes) would regress
 * over two different experiments and zigzag the plotted curves.
 */
import type { QecCampaignStatsRow } from '../types/qec';
import { roundsFromMetadata } from './qecRounds';

export interface ExperimentInfo {
  /** Unique, stable identity of the experiment (decoder + metadata + rounds scheme). */
  key: string;
  /** Human-readable, unique per decoder: label plus rounds scheme, disambiguated if needed. */
  name: string;
  /** Rounds scheme tag such as `r=d`, `r=3d`, `r=12`; empty when rounds are unknown. */
  roundsTag: string;
}

const SWEEP_KEYS = new Set(['d', 'p', 'r', 'rounds']);

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function metaOf(row: QecCampaignStatsRow): Record<string, unknown> {
  return typeof row.json_metadata === 'object' && row.json_metadata !== null
    ? (row.json_metadata as Record<string, unknown>)
    : {};
}

function baseKey(row: QecCampaignStatsRow): string {
  const rest = Object.fromEntries(Object.entries(metaOf(row)).filter(([k]) => !SWEEP_KEYS.has(k)));
  return `${row.decoder}\u0000${stable(rest)}`;
}

const distanceOf = (row: QecCampaignStatsRow): number | null => {
  const d = metaOf(row).d;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
};

function ratioTag(k: number): string {
  if (k === 1) return 'r=d';
  return Number.isInteger(k) ? `r=${k}d` : `r=${Number(k.toPrecision(3))}d`;
}

/** Rounds-scheme tag for every row of one base group. */
function roundsTags(group: readonly QecCampaignStatsRow[]): string[] {
  const info = group.map((row) => ({ r: roundsFromMetadata(row.json_metadata), d: distanceOf(row) }));
  const ratios = new Set(info.filter((i) => i.r !== null && i.d !== null).map((i) => i.r! / i.d!));
  const fixed = new Set(info.filter((i) => i.r !== null).map((i) => i.r!));
  const useRatio = ratios.size > 0 && ratios.size <= fixed.size;
  return info.map((i) => {
    if (i.r === null) return '';
    if (useRatio && i.d !== null) return ratioTag(i.r / i.d);
    return `r=${i.r}`;
  });
}

/** Map every row to its experiment (see module doc). Keyed by row object identity. */
export function assignExperiments(rows: readonly QecCampaignStatsRow[]): Map<QecCampaignStatsRow, ExperimentInfo> {
  const bases = new Map<string, QecCampaignStatsRow[]>();
  for (const row of rows) bases.set(baseKey(row), [...(bases.get(baseKey(row)) ?? []), row]);

  const partial: Array<{ row: QecCampaignStatsRow; key: string; name: string; roundsTag: string; decoder: string }> = [];
  for (const [bk, group] of bases) {
    const tags = roundsTags(group);
    group.forEach((row, i) => {
      const label = metaOf(row).label;
      const base = typeof label === 'string' && label !== '' ? label : 'unlabeled';
      partial.push({
        row, decoder: row.decoder, roundsTag: tags[i], key: `${bk}\u0000${tags[i]}`,
        name: tags[i] ? `${base} ${tags[i]}` : base,
      });
    });
  }

  // Disambiguate experiments that still share a display name under one decoder.
  const keysByName = new Map<string, string[]>();
  for (const p of partial) {
    const id = `${p.decoder}\u0000${p.name}`;
    const keys = keysByName.get(id) ?? [];
    if (!keys.includes(p.key)) keysByName.set(id, [...keys, p.key]);
  }
  const out = new Map<QecCampaignStatsRow, ExperimentInfo>();
  for (const p of partial) {
    const keys = [...(keysByName.get(`${p.decoder}\u0000${p.name}`) ?? [])].sort();
    const idx = keys.indexOf(p.key);
    const name = keys.length > 1 ? `${p.name} #${idx + 1}` : p.name;
    out.set(p.row, { key: p.key, name, roundsTag: p.roundsTag });
  }
  return out;
}
