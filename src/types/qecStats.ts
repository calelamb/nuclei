import type { QecCampaignStatsRow } from './qec';

/**
 * PRD 10 Phase E — QEC campaign analysis.
 *
 * Pure, exhaustively tested transforms over sinter campaign stats: parse
 * sinter's native CSV (the on-disk truth), compute logical error rates with
 * Wilson confidence intervals from the raw counts, build threshold series
 * (LER vs noise, per label×distance, by decoder), fit Λ (the error-
 * suppression factor between successive distances), and shape the decoder
 * workbench. No DOM, no charting side effects.
 */

// ─────────────────────────── sinter CSV ───────────────────────────

const SINTER_HEADER_COLS = [
  'shots', 'errors', 'discards', 'seconds', 'decoder', 'strong_id', 'json_metadata', 'custom_counts',
];

/** Split one CSV line honoring quoted fields with doubled-quote escaping —
 * sinter embeds JSON (full of commas + quotes) in the json_metadata field. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } // escaped quote
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

/**
 * Parse sinter's native stats.csv into rows. Tolerant of the leading
 * whitespace sinter pads its numeric columns with. Rows that don't parse are
 * skipped (never throws) — a partial/corrupt CSV still yields what it can.
 */
export function parseSinterCsv(text: string): QecCampaignStatsRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((c) => c.trim());
  // Only accept a genuine sinter header; otherwise bail (empty).
  const looksLikeHeader = SINTER_HEADER_COLS.every((c) => header.includes(c));
  const dataLines = looksLikeHeader ? lines.slice(1) : [];
  const idx = (name: string) => header.indexOf(name);

  const rows: QecCampaignStatsRow[] = [];
  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    try {
      const meta = cells[idx('json_metadata')]?.trim();
      const customRaw = cells[idx('custom_counts')]?.trim();
      const row: QecCampaignStatsRow = {
        shots: Number(cells[idx('shots')]?.trim()),
        errors: Number(cells[idx('errors')]?.trim()),
        discards: Number(cells[idx('discards')]?.trim()),
        seconds: Number(cells[idx('seconds')]?.trim()),
        decoder: cells[idx('decoder')]?.trim() ?? '',
        strong_id: cells[idx('strong_id')]?.trim() ?? '',
        json_metadata: meta ? JSON.parse(meta) : {},
        custom_counts: customRaw ? JSON.parse(customRaw) : {},
      };
      if (Number.isFinite(row.shots) && Number.isFinite(row.errors)) rows.push(row);
    } catch {
      /* skip malformed row */
    }
  }
  return rows;
}

// ─────────────────────────── Logical error rate ───────────────────────────

export interface Rate {
  /** Point estimate errors/shots. */
  p: number;
  /** Wilson score interval bounds. */
  lo: number;
  hi: number;
}

/**
 * Wilson score interval for a binomial proportion — the correct CI for a
 * logical error rate (unlike the naive normal approximation it stays inside
 * [0,1] and behaves at small error counts, which QEC campaigns routinely hit).
 * z defaults to 1.96 (95%).
 */
export function wilsonInterval(errors: number, shots: number, z = 1.96): Rate {
  if (shots <= 0) return { p: 0, lo: 0, hi: 0 };
  const phat = errors / shots;
  const z2 = z * z;
  const denom = 1 + z2 / shots;
  const center = (phat + z2 / (2 * shots)) / denom;
  const margin =
    (z / denom) * Math.sqrt((phat * (1 - phat)) / shots + z2 / (4 * shots * shots));
  return { p: phat, lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) };
}

export function logicalErrorRate(row: QecCampaignStatsRow, z = 1.96): Rate {
  return wilsonInterval(row.errors, row.shots, z);
}

// ─────────────────────────── Metadata extraction ───────────────────────────

export interface StatsPoint {
  label: string;
  distance: number | null;
  noise: number | null;
  decoder: string;
  rate: Rate;
  shots: number;
  errors: number;
  seconds: number;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Pull the campaign-convention fields (label, d, p) out of json_metadata. */
export function toStatsPoint(row: QecCampaignStatsRow, z = 1.96): StatsPoint {
  const meta = (row.json_metadata ?? {}) as Record<string, unknown>;
  return {
    label: typeof meta.label === 'string' ? meta.label : row.strong_id.slice(0, 8),
    distance: num(meta.d),
    noise: num(meta.p),
    decoder: row.decoder,
    rate: logicalErrorRate(row, z),
    shots: row.shots,
    errors: row.errors,
    seconds: row.seconds,
  };
}

// ─────────────────────────── Threshold series ───────────────────────────

export interface ThresholdSeries {
  /** Series key: `${label}·d${distance}·${decoder}`. */
  key: string;
  label: string;
  distance: number | null;
  decoder: string;
  /** Points sorted by ascending noise parameter. */
  points: Array<{ noise: number; rate: Rate }>;
}

/** Group stats into log-log threshold series: one per (label × distance ×
 * decoder), each a noise-sorted list of LER±CI points. */
export function thresholdSeries(rows: QecCampaignStatsRow[], z = 1.96): ThresholdSeries[] {
  const groups = new Map<string, ThresholdSeries>();
  for (const row of rows) {
    const pt = toStatsPoint(row, z);
    if (pt.noise === null) continue;
    const key = `${pt.label}·d${pt.distance ?? '?'}·${pt.decoder}`;
    let series = groups.get(key);
    if (!series) {
      series = { key, label: pt.label, distance: pt.distance, decoder: pt.decoder, points: [] };
      groups.set(key, series);
    }
    series.points.push({ noise: pt.noise, rate: pt.rate });
  }
  for (const s of groups.values()) s.points.sort((a, b) => a.noise - b.noise);
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ─────────────────────────── Λ fit ───────────────────────────

export interface LambdaFit {
  decoder: string;
  /** Λ per noise point: ratio LER(d) / LER(d+step) at that noise. */
  perNoise: Array<{ noise: number; fromDistance: number; toDistance: number; lambda: number }>;
  /** Geometric-mean Λ over the points where suppression holds (Λ > 1). */
  lambda: number | null;
}

/**
 * Fit Λ, the error-suppression factor: at each noise point, the ratio of the
 * logical error rate between successive distances (smaller / larger). Λ > 1
 * means adding distance suppresses errors (below threshold). Reports the
 * per-point ratios and a geometric-mean Λ over the suppressing points.
 */
export function lambdaFit(rows: QecCampaignStatsRow[]): LambdaFit[] {
  const byDecoder = new Map<string, StatsPoint[]>();
  for (const row of rows) {
    const pt = toStatsPoint(row);
    if (pt.distance === null || pt.noise === null) continue;
    const list = byDecoder.get(pt.decoder) ?? [];
    list.push(pt);
    byDecoder.set(pt.decoder, list);
  }

  const out: LambdaFit[] = [];
  for (const [decoder, points] of byDecoder) {
    // Index by noise then distance.
    const byNoise = new Map<number, Map<number, StatsPoint>>();
    for (const pt of points) {
      const m = byNoise.get(pt.noise!) ?? new Map<number, StatsPoint>();
      m.set(pt.distance!, pt);
      byNoise.set(pt.noise!, m);
    }
    const perNoise: LambdaFit['perNoise'] = [];
    for (const [noise, dMap] of byNoise) {
      const distances = [...dMap.keys()].sort((a, b) => a - b);
      for (let i = 0; i + 1 < distances.length; i += 1) {
        const dA = distances[i];
        const dB = distances[i + 1];
        const rA = dMap.get(dA)!.rate.p;
        const rB = dMap.get(dB)!.rate.p;
        if (rB > 0) perNoise.push({ noise, fromDistance: dA, toDistance: dB, lambda: rA / rB });
      }
    }
    const suppressing = perNoise.filter((e) => e.lambda > 1);
    const lambda =
      suppressing.length > 0
        ? Math.exp(suppressing.reduce((s, e) => s + Math.log(e.lambda), 0) / suppressing.length)
        : null;
    perNoise.sort((a, b) => a.noise - b.noise || a.fromDistance - b.fromDistance);
    out.push({ decoder, perNoise, lambda });
  }
  return out.sort((a, b) => a.decoder.localeCompare(b.decoder));
}

/**
 * Projected code distance to reach a target logical error rate, given a
 * measured rate at a base distance and Λ: each +`step` distance divides the
 * rate by Λ. Returns null when Λ ≤ 1 (no suppression → target unreachable).
 */
export function projectedDistanceForTarget(
  baseDistance: number,
  baseRate: number,
  lambda: number,
  target: number,
  step = 2,
): number | null {
  if (lambda <= 1 || baseRate <= 0 || target <= 0) return null;
  if (baseRate <= target) return baseDistance;
  const steps = Math.ceil(Math.log(baseRate / target) / Math.log(lambda));
  return baseDistance + step * steps;
}

// ─────────────────────────── Decoder workbench ───────────────────────────

export interface DecoderWorkbenchRow {
  decoder: string;
  shots: number;
  errors: number;
  rate: Rate;
  /** Wall-seconds per shot (sinter's timing), the decode-speed comparison. */
  secondsPerShot: number;
}

/** Aggregate a campaign's rows per decoder for the honest side-by-side
 * comparison: pooled LER±CI, total shots/errors, and decode time per shot. */
export function decoderWorkbench(rows: QecCampaignStatsRow[], z = 1.96): DecoderWorkbenchRow[] {
  const agg = new Map<string, { shots: number; errors: number; seconds: number }>();
  for (const row of rows) {
    const a = agg.get(row.decoder) ?? { shots: 0, errors: 0, seconds: 0 };
    a.shots += row.shots;
    a.errors += row.errors;
    a.seconds += row.seconds;
    agg.set(row.decoder, a);
  }
  return [...agg.entries()]
    .map(([decoder, a]) => ({
      decoder,
      shots: a.shots,
      errors: a.errors,
      rate: wilsonInterval(a.errors, a.shots, z),
      secondsPerShot: a.shots > 0 ? a.seconds / a.shots : 0,
    }))
    .sort((x, y) => x.decoder.localeCompare(y.decoder));
}

// ─────────────────────────── Export ───────────────────────────

/** Flatten stats points to a plain analysis CSV (label,distance,noise,decoder,
 * shots,errors,ler,ler_lo,ler_hi) — the derived view, alongside the raw
 * sinter stats.csv. */
export function statsPointsToCsv(rows: QecCampaignStatsRow[]): string {
  const header = 'label,distance,noise,decoder,shots,errors,ler,ler_lo,ler_hi';
  const lines = rows.map((r) => {
    const pt = toStatsPoint(r);
    return [
      JSON.stringify(pt.label),
      pt.distance ?? '',
      pt.noise ?? '',
      pt.decoder,
      pt.shots,
      pt.errors,
      pt.rate.p,
      pt.rate.lo,
      pt.rate.hi,
    ].join(',');
  });
  return [header, ...lines].join('\n') + '\n';
}
