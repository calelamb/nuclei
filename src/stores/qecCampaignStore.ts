import { create } from 'zustand';
import type { QecCampaignStatsRow } from '../types/qec';
import { parseSinterCsvDetailed, serializeSinterCsv, type CsvRowIssue, type SinterCsvParse } from '../types/sinterCsv';
import type { PreparedImport } from '../services/qecCsvPrepare';
import type { RateUnits } from '../lib/qecFit';
import { applyMapping, guessMapping, noNumericKeysProblem, type SinterMapping } from '../types/sinterMapping';

/**
 * PRD 10 Phase E — live QEC campaign state for the analysis surfaces.
 *
 * Holds the current campaign's sinter-native stats CSV (the on-disk truth the
 * threshold/workbench panels parse), plus progress and a resume/stale flag.
 *
 * Progress arrives as strong_id-keyed changed-row events (PRD 11 D5 contract):
 * the runner merges accumulated totals per task, so `mergeRows` keys by
 * strong_id and overwrites rather than appends. `resumable` is set when a
 * `running`-status campaign manifest was found on disk from a prior session
 * (killed mid-run) — the chip and analysis view surface "resume".
 */
export interface CampaignProgress {
  tasksComplete: number;
  tasksTotal: number;
  sampledShots: number;
  statusMessage: string;
}

/** A sinter CSV loaded from disk/drop: the aggregated rows as written plus the
 * user-editable mapping from json_metadata keys to plot fields. */
export interface CsvImport {
  sourceName: string;
  /** Aggregated rows, exactly as in the file (unmapped). */
  rows: QecCampaignStatsRow[];
  mapping: SinterMapping;
  issues: CsvRowIssue[];
  /** Data records in the file before duplicate strong_ids were folded. */
  totalDataRows: number;
  /** Data records dropped as invalid (not merged). */
  rejectedRows: number;
}

export interface CsvLoadResult {
  ok: boolean;
  fatal: string | null;
  issues: CsvRowIssue[];
}

interface QecCampaignState {
  /** Sinter-native stats.csv of the current/last campaign. */
  statsCsv: string | null;
  /** Live per-task rows keyed by strong_id (merged from progress events). */
  rowsByStrongId: Record<string, QecCampaignStatsRow>;
  running: boolean;
  progress: CampaignProgress | null;
  /** Name of the experiment whose campaign this is. */
  campaignName: string | null;
  /** A prior run left a `running` manifest — offer resume. */
  resumable: { runDir: string; name: string } | null;
  /** Set while the plotted data came from a dropped/opened sinter CSV. */
  csvImport: CsvImport | null;
  /** Last CSV load failure (shown in the UI); cleared by the next success. */
  csvError: string | null;
  /** Units the person asked for; shared by the plot, Λ readout and decoder
   * table, and kept while they navigate away. Falls back to per-shot where
   * rounds are unknown (see useQecUnits). */
  requestedUnits: RateUnits;
  /** Name of the CSV being read/parsed right now, for "Reading…" feedback. */
  csvLoading: string | null;

  /** Parse untrusted sinter CSV text, aggregate duplicate strong_ids, guess a
   * mapping, and plot it. On a whole-file failure existing data is kept. */
  loadFromCsv(text: string, sourceName: string): CsvLoadResult;
  /** Same as loadFromCsv for text that was already parsed (e.g. in a worker); `prepared` carries the mapping and
   * derived data when a worker already computed them. */
  loadParsed(parsed: SinterCsvParse, sourceName: string, prepared?: PreparedImport | null): CsvLoadResult;
  setCsvMapping(mapping: SinterMapping): void;
  clearCsvError(): void;
  setRequestedUnits(units: RateUnits): void;
  setCsvLoading(name: string | null): void;

  startCampaign(name: string, tasksTotal: number): void;
  /** Merge changed-row events (keyed by strong_id) + progress counters. */
  mergeRows(rows: QecCampaignStatsRow[], progress: Partial<CampaignProgress>): void;
  finishCampaign(statsCsv: string, rows: QecCampaignStatsRow[]): void;
  setResumable(resumable: { runDir: string; name: string } | null): void;
  reset(): void;
}

const EMPTY_PARSE: SinterCsvParse = { rows: [], issues: [], fatal: null, totalDataRows: 0, rejectedRows: 0 };

function indexRows(rows: readonly QecCampaignStatsRow[]): Record<string, QecCampaignStatsRow> {
  // fromEntries defines own properties, so a hostile strong_id like
  // "__proto__" stays plain data instead of rewriting the prototype.
  return Object.fromEntries(rows.map((r) => [r.strong_id, r]));
}

function indexMapped(rows: QecCampaignStatsRow[], mapping: SinterMapping): Record<string, QecCampaignStatsRow> {
  return indexRows(applyMapping(rows, mapping));
}

export const useQecCampaignStore = create<QecCampaignState>((set, get) => ({
  statsCsv: null,
  rowsByStrongId: {},
  running: false,
  progress: null,
  campaignName: null,
  resumable: null,
  csvImport: null,
  csvError: null,
  requestedUnits: 'per_round',
  csvLoading: null,

  loadFromCsv: (text, sourceName) =>
    // Do not tokenize a file that cannot be loaded right now.
    get().loadParsed(get().running ? EMPTY_PARSE : parseSinterCsvDetailed(text), sourceName),

  loadParsed: (parsed, sourceName, prepared) => {
    if (get().running) {
      const fatal = 'A campaign is running; wait for it to finish or cancel it before loading a CSV.';
      set({ csvError: fatal });
      return { ok: false, fatal, issues: [] };
    }
    if (parsed.fatal !== null) {
      set({ csvError: parsed.fatal });
      return { ok: false, fatal: parsed.fatal, issues: [] };
    }
    // A prepared import was only built for a plottable file, so the check already passed.
    const noKeys = prepared ? null : noNumericKeysProblem(parsed.rows);
    if (noKeys !== null) {
      set({ csvError: noKeys });
      return { ok: false, fatal: noKeys, issues: parsed.issues };
    }
    const mapping = prepared?.mapping ?? guessMapping(parsed.rows);
    set({
      csvImport: {
        sourceName, rows: parsed.rows, mapping, issues: parsed.issues,
        totalDataRows: parsed.totalDataRows, rejectedRows: parsed.rejectedRows,
      },
      csvError: null,
      statsCsv: prepared?.statsCsv ?? serializeSinterCsv(parsed.rows),
      rowsByStrongId: prepared ? indexRows(prepared.mapped) : indexMapped(parsed.rows, mapping),
      running: false,
      progress: null,
      campaignName: sourceName,
    });
    return { ok: true, fatal: null, issues: parsed.issues };
  },

  setCsvMapping: (mapping) =>
    set((state) =>
      state.csvImport
        ? {
            csvImport: { ...state.csvImport, mapping },
            rowsByStrongId: indexMapped(state.csvImport.rows, mapping),
          }
        : {},
    ),

  clearCsvError: () => set({ csvError: null }),

  setRequestedUnits: (requestedUnits) => set({ requestedUnits }),

  setCsvLoading: (csvLoading) => set({ csvLoading }),

  startCampaign: (campaignName, tasksTotal) =>
    set({
      csvImport: null,
      csvError: null,
      running: true,
      campaignName,
      statsCsv: null,
      rowsByStrongId: {},
      progress: { tasksComplete: 0, tasksTotal, sampledShots: 0, statusMessage: 'starting…' },
    }),

  mergeRows: (rows, progress) =>
    set((state) => {
      const next = { ...state.rowsByStrongId };
      for (const r of rows) next[r.strong_id] = r; // overwrite: rows carry totals
      return {
        rowsByStrongId: next,
        progress: { ...(state.progress ?? { tasksComplete: 0, tasksTotal: 0, sampledShots: 0, statusMessage: '' }), ...progress },
      };
    }),

  finishCampaign: (statsCsv, rows) =>
    set((state) => {
      const next = { ...state.rowsByStrongId };
      for (const r of rows) next[r.strong_id] = r;
      return { statsCsv, rowsByStrongId: next, running: false };
    }),

  setResumable: (resumable) => set({ resumable }),

  reset: () =>
    set({
      statsCsv: null, rowsByStrongId: {}, running: false, progress: null, campaignName: null,
      resumable: null, csvImport: null, csvError: null, requestedUnits: 'per_round', csvLoading: null,
    }),
}));

/** Current stats rows (finished CSV parsed, else the live merged rows). */
export function currentCampaignRows(state: QecCampaignState): QecCampaignStatsRow[] {
  return Object.values(state.rowsByStrongId);
}
