import { create } from 'zustand';
import type { QecCampaignStatsRow } from '../types/qec';
import { parseSinterCsvDetailed, serializeSinterCsv, type CsvRowIssue } from '../types/sinterCsv';
import { applyMapping, guessMapping, type SinterMapping } from '../types/sinterMapping';

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

  /** Parse untrusted sinter CSV text, aggregate duplicate strong_ids, guess a
   * mapping, and plot it. On a whole-file failure existing data is kept. */
  loadFromCsv(text: string, sourceName: string): CsvLoadResult;
  setCsvMapping(mapping: SinterMapping): void;
  clearCsvError(): void;

  startCampaign(name: string, tasksTotal: number): void;
  /** Merge changed-row events (keyed by strong_id) + progress counters. */
  mergeRows(rows: QecCampaignStatsRow[], progress: Partial<CampaignProgress>): void;
  finishCampaign(statsCsv: string, rows: QecCampaignStatsRow[]): void;
  setResumable(resumable: { runDir: string; name: string } | null): void;
  reset(): void;
}

function indexMapped(rows: QecCampaignStatsRow[], mapping: SinterMapping): Record<string, QecCampaignStatsRow> {
  // fromEntries defines own properties, so a hostile strong_id like
  // "__proto__" stays plain data instead of rewriting the prototype.
  return Object.fromEntries(applyMapping(rows, mapping).map((r) => [r.strong_id, r]));
}

export const useQecCampaignStore = create<QecCampaignState>((set) => ({
  statsCsv: null,
  rowsByStrongId: {},
  running: false,
  progress: null,
  campaignName: null,
  resumable: null,
  csvImport: null,
  csvError: null,

  loadFromCsv: (text, sourceName) => {
    if (useQecCampaignStore.getState().running) {
      const fatal = 'A campaign is running; wait for it to finish or cancel it before loading a CSV.';
      set({ csvError: fatal });
      return { ok: false, fatal, issues: [] };
    }
    const parsed = parseSinterCsvDetailed(text);
    if (parsed.fatal !== null) {
      set({ csvError: parsed.fatal });
      return { ok: false, fatal: parsed.fatal, issues: [] };
    }
    const mapping = guessMapping(parsed.rows);
    set({
      csvImport: {
        sourceName, rows: parsed.rows, mapping, issues: parsed.issues, totalDataRows: parsed.totalDataRows,
      },
      csvError: null,
      statsCsv: serializeSinterCsv(parsed.rows),
      rowsByStrongId: indexMapped(parsed.rows, mapping),
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
      resumable: null, csvImport: null, csvError: null,
    }),
}));

/** Current stats rows (finished CSV parsed, else the live merged rows). */
export function currentCampaignRows(state: QecCampaignState): QecCampaignStatsRow[] {
  return Object.values(state.rowsByStrongId);
}
