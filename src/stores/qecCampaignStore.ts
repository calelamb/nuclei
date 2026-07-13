import { create } from 'zustand';
import type { QecCampaignStatsRow } from '../types/qec';

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

  startCampaign(name: string, tasksTotal: number): void;
  /** Merge changed-row events (keyed by strong_id) + progress counters. */
  mergeRows(rows: QecCampaignStatsRow[], progress: Partial<CampaignProgress>): void;
  finishCampaign(statsCsv: string, rows: QecCampaignStatsRow[]): void;
  setResumable(resumable: { runDir: string; name: string } | null): void;
  reset(): void;
}

export const useQecCampaignStore = create<QecCampaignState>((set) => ({
  statsCsv: null,
  rowsByStrongId: {},
  running: false,
  progress: null,
  campaignName: null,
  resumable: null,

  startCampaign: (campaignName, tasksTotal) =>
    set({
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
    set({ statsCsv: null, rowsByStrongId: {}, running: false, progress: null, campaignName: null, resumable: null }),
}));

/** Current stats rows (finished CSV parsed, else the live merged rows). */
export function currentCampaignRows(state: QecCampaignState): QecCampaignStatsRow[] {
  return Object.values(state.rowsByStrongId);
}
