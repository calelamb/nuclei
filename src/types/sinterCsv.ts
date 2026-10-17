import { z } from 'zod';
import type { QecCampaignStatsRow } from './qec';

/**
 * Untrusted-input parser for sinter's native stats CSV.
 *
 * Mirrors `sinter.read_stats_from_csv_files` (sinter/_data/_existing_data.py):
 * rows sharing a `strong_id` are folded together by summing shots, errors,
 * discards and seconds and adding custom_counts (collections.Counter
 * addition); the first row's decoder + json_metadata are kept, and a later
 * row whose decoder/json_metadata disagree is rejected (sinter raises there).
 *
 * Unlike sinter this never throws: bad rows become `issues` the UI shows, and
 * only whole-file problems (size, missing columns) are `fatal`. Nothing here
 * evaluates input as code — metadata goes through JSON.parse and zod only.
 */

export const MAX_CSV_BYTES = 25 * 1024 * 1024;
export const MAX_CSV_ROWS = 200_000;
const MAX_REPORTED_ISSUES = 25;
/** Columns sinter requires; custom_counts is optional (older files). */
const REQUIRED_COLUMNS = ['shots', 'errors', 'discards', 'seconds', 'decoder', 'strong_id', 'json_metadata'];
/** Columns that identify Nuclei's own plot CSV export. It carries every sinter
 * column except `seconds`, which re-imports as 0 (timing was not exported). */
const NUCLEI_EXPORT_COLUMNS = ['experiment', 'distance', 'noise', 'kept_shots'];

export interface CsvRowIssue {
  /** 1-based physical line the record starts on. */
  line: number;
  message: string;
}

export interface SinterCsvParse {
  rows: QecCampaignStatsRow[];
  issues: CsvRowIssue[];
  /** Whole-file failure; `rows` is empty when set. */
  fatal: string | null;
  /** Data records seen (before aggregation), for "N rows -> M tasks" display. */
  totalDataRows: number;
  /** Data records that were rejected (invalid, or conflicting strong_id). */
  rejectedRows: number;
}

interface CsvRecord { fields: string[]; line: number }

/** RFC-4180-style tokenizer: quoted fields may contain commas, doubled quotes
 * and newlines; blank records are skipped. */
function tokenizeCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  const endRecord = (): void => {
    fields.push(field);
    if (!(fields.length === 1 && fields[0].trim() === '')) records.push({ fields, line: recordLine });
    fields = [];
    field = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { fields.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else field += ch;
  }
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}

/** Split one CSV line honoring quoted fields with doubled-quote escaping. */
export function splitCsvLine(line: string): string[] {
  return tokenizeCsv(line)[0]?.fields ?? [''];
}

const INT_RE = /^[+-]?\d+$/;

function parseInteger(raw: string, name: string): number {
  const t = raw.trim();
  if (!INT_RE.test(t)) throw new Error(`${name} must be an integer, got "${raw.trim().slice(0, 30)}"`);
  return Number(t);
}

function parseSeconds(raw: string): number {
  const t = raw.trim();
  const n = t === '' ? NaN : Number(t);
  if (!Number.isFinite(n)) throw new Error(`seconds must be a number, got "${t.slice(0, 30)}"`);
  return n;
}

function parseJson(raw: string, name: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON: ${raw.trim().slice(0, 40)}`);
  }
}

const rowSchema = z
  .object({
    shots: z.int().nonnegative(),
    errors: z.int().nonnegative(),
    discards: z.int().nonnegative(),
    seconds: z.number().finite().nonnegative(),
    decoder: z.string(),
    strong_id: z.string().min(1, 'strong_id is empty'),
    json_metadata: z.record(z.string(), z.unknown(), 'json_metadata must be a JSON object'),
    custom_counts: z.record(z.string(), z.int()),
  })
  .refine((r) => r.errors + r.discards <= r.shots, {
    message: 'errors + discards exceeds shots',
  });

function rawRow(cells: string[], col: Map<string, number>): unknown {
  const cell = (name: string): string => cells[col.get(name) ?? -1] ?? '';
  const meta = cell('json_metadata').trim();
  const custom = col.has('custom_counts') ? cell('custom_counts').trim() : '';
  return {
    shots: parseInteger(cell('shots'), 'shots'),
    errors: parseInteger(cell('errors'), 'errors'),
    discards: parseInteger(cell('discards'), 'discards'),
    seconds: col.has('seconds') ? parseSeconds(cell('seconds')) : 0,
    decoder: cell('decoder').trim(),
    strong_id: cell('strong_id').trim(),
    json_metadata: meta === '' ? {} : parseJson(meta, 'json_metadata'),
    custom_counts: custom === '' ? {} : parseJson(custom, 'custom_counts'),
  };
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k)
      && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** collections.Counter addition: sums, and drops keys whose total is <= 0. */
function addCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const total = (Object.hasOwn(a, k) ? a[k] : 0) + (Object.hasOwn(b, k) ? b[k] : 0);
    if (total > 0) Object.defineProperty(out, k, { value: total, enumerable: true, writable: true, configurable: true });
  }
  return Object.fromEntries(Object.entries(out));
}

/** Sum two rows of the same task, as sinter does for a shared strong_id. */
export function foldStatsRows(prev: QecCampaignStatsRow, next: QecCampaignStatsRow): QecCampaignStatsRow {
  return {
    ...prev,
    shots: prev.shots + next.shots,
    errors: prev.errors + next.errors,
    discards: prev.discards + next.discards,
    seconds: prev.seconds + next.seconds,
    custom_counts: addCounts(prev.custom_counts, next.custom_counts),
  };
}

function headerProblem(header: string[]): { col: Map<string, number>; fatal: string | null } {
  const col = new Map<string, number>();
  header.forEach((name, i) => { if (!col.has(name)) col.set(name, i); });
  const isNucleiExport = NUCLEI_EXPORT_COLUMNS.every((c) => col.has(c));
  const missing = REQUIRED_COLUMNS.filter((c) => !col.has(c) && !(isNucleiExport && c === 'seconds'));
  const fatal = missing.length
    ? `Not a sinter stats CSV: missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. Found: ${header.slice(0, 12).join(', ') || '(none)'}.`
    : null;
  return { col, fatal };
}

const failed = (fatal: string): SinterCsvParse => ({ rows: [], issues: [], fatal, totalDataRows: 0, rejectedRows: 0 });

/** Parse + aggregate a sinter stats CSV. Never throws. */
export function parseSinterCsvDetailed(text: string): SinterCsvParse {
  if (text.length > MAX_CSV_BYTES) {
    return failed(`File is too large (${(text.length / 1048576).toFixed(1)} MB; limit ${MAX_CSV_BYTES / 1048576} MB).`);
  }
  const records = tokenizeCsv(text.replace(/^\uFEFF/, ''));
  if (records.length === 0) return failed('The file is empty.');
  const { col, fatal } = headerProblem(records[0].fields.map((c) => c.trim()));
  if (fatal) return failed(fatal);
  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) return failed('The file has a header but no data rows.');
  if (dataRecords.length > MAX_CSV_ROWS) {
    return failed(`Too many rows (${dataRecords.length}; limit ${MAX_CSV_ROWS}).`);
  }

  const byId = new Map<string, QecCampaignStatsRow>();
  const issues: CsvRowIssue[] = [];
  let suppressed = 0;
  let rejected = 0;
  const report = (line: number, message: string): void => {
    rejected += 1;
    if (issues.length < MAX_REPORTED_ISSUES) issues.push({ line, message });
    else suppressed += 1;
  };

  for (const rec of dataRecords) {
    try {
      const parsed = rowSchema.safeParse(rawRow(rec.fields, col));
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const where = first.path.length ? `${first.path.join('.')}: ` : '';
        report(rec.line, `${where}${first.message}`);
        continue;
      }
      const row: QecCampaignStatsRow = parsed.data;
      const prev = byId.get(row.strong_id);
      if (!prev) byId.set(row.strong_id, row);
      else if (prev.decoder !== row.decoder || !jsonEqual(prev.json_metadata, row.json_metadata)) {
        report(rec.line, `same strong_id "${row.strong_id.slice(0, 12)}" as an earlier row but different decoder/json_metadata; row ignored`);
      } else byId.set(row.strong_id, foldStatsRows(prev, row));
    } catch (err) {
      report(rec.line, err instanceof Error ? err.message : 'unreadable row');
    }
  }
  const rejectedRows = rejected;
  if (suppressed > 0) issues.push({ line: 0, message: `…and ${suppressed} more problem rows not shown` });
  return { rows: [...byId.values()], issues, fatal: null, totalDataRows: dataRecords.length, rejectedRows };
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Write rows in sinter's native layout (all eight columns, so discards and
 * custom_counts survive). */
export function serializeSinterCsv(rows: readonly QecCampaignStatsRow[]): string {
  const lines = rows.map((r) => {
    const counts = Object.keys(r.custom_counts).length > 0 ? JSON.stringify(r.custom_counts) : '';
    return [
      r.shots, r.errors, r.discards, r.seconds, csvField(r.decoder), csvField(r.strong_id),
      csvField(JSON.stringify(r.json_metadata ?? {})), csvField(counts),
    ].join(',');
  });
  return ['shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts', ...lines].join('\n') + '\n';
}
