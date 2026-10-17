import type { QecCampaignStatsRow } from '../types/qec';

export interface ProbabilityCheck {
  /** Rows whose mapped p is a finite number outside (0, 1]. */
  outside: number;
  /** Rows carrying a finite numeric p at all. */
  total: number;
  min: number | null;
  max: number | null;
}

function numericValue(row: QecCampaignStatsRow, key: string): number | null {
  const v = (row.json_metadata as Record<string, unknown> | null)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** How many of a metadata column's numeric values are not probabilities (outside (0, 1]); p = 0 is a valid physical rate and is not counted. */
export function checkProbabilityColumn(rows: readonly QecCampaignStatsRow[], key: string): ProbabilityCheck {
  const values = rows.map((r) => numericValue(r, key)).filter((v): v is number => v !== null);
  const outside = values.filter((v) => v < 0 || v > 1).length;
  return {
    outside,
    total: values.length,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
  };
}

/** True when any numeric value in the column falls outside [0, 1]. */
export function isNotProbability(rows: readonly QecCampaignStatsRow[], key: string): boolean {
  return checkProbabilityColumn(rows, key).outside > 0;
}
