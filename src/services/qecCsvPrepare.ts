import type { QecCampaignStatsRow } from '../types/qec';
import { parseSinterCsvDetailed, serializeSinterCsv, type SinterCsvParse } from '../types/sinterCsv';
import { applyMapping, guessMapping, noNumericKeysProblem, type SinterMapping } from '../types/sinterMapping';

/** What loading a plottable CSV needs beyond the parsed rows: all of it heavy for 100k-row files. */
export interface PreparedImport {
  mapping: SinterMapping;
  statsCsv: string;
  /** Rows after the guessed mapping (replicates folded), ready to plot. */
  mapped: QecCampaignStatsRow[];
}

export interface PreparedCsv {
  parsed: SinterCsvParse;
  /** Null when the file failed to parse or is not plottable; `parsed.fatal` / loadParsed explain why. */
  prepared: PreparedImport | null;
}

/** Everything the store does with CSV text that can run off the main thread. Pure; never throws. */
export function prepareSinterCsv(text: string): PreparedCsv {
  const parsed = parseSinterCsvDetailed(text);
  if (parsed.fatal !== null || noNumericKeysProblem(parsed.rows) !== null) return { parsed, prepared: null };
  const mapping = guessMapping(parsed.rows);
  return { parsed, prepared: { mapping, statsCsv: serializeSinterCsv(parsed.rows), mapped: applyMapping(parsed.rows, mapping) } };
}
