import { MAX_CSV_BYTES } from '../types/sinterCsv';
import { useQecCampaignStore, type CsvLoadResult } from '../stores/qecCampaignStore';

/** Files above this size take long enough to parse that the UI shows progress first. */
const SLOW_PARSE_BYTES = 256 * 1024;

const nextPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** Minimal File surface we need (lets tests pass plain objects). */
export interface CsvFileLike {
  name: string;
  size: number;
  text(): Promise<string>;
}

/**
 * Read a user-supplied file and plot it. The size cap is checked on
 * `file.size` BEFORE reading so an oversized file never enters memory; the
 * text then goes through the zod-validated parser in the store. Never throws:
 * every failure lands in the store's `csvError` for the UI.
 */
export async function loadCsvFile(file: CsvFileLike): Promise<CsvLoadResult> {
  const store = useQecCampaignStore.getState();
  if (file.size > MAX_CSV_BYTES) {
    const fatal = `${file.name} is too large (${(file.size / 1048576).toFixed(1)} MB; limit ${MAX_CSV_BYTES / 1048576} MB).`;
    useQecCampaignStore.setState({ csvError: fatal });
    return { ok: false, fatal, issues: [] };
  }
  store.setCsvLoading(file.name);
  try {
    const text = await file.text();
    // Parsing a big file blocks the main thread: let "Reading…" paint first.
    if (file.size > SLOW_PARSE_BYTES) await nextPaint();
    return useQecCampaignStore.getState().loadFromCsv(text, file.name);
  } catch (err) {
    const fatal = `Could not read ${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`;
    useQecCampaignStore.setState({ csvError: fatal });
    return { ok: false, fatal, issues: [] };
  } finally {
    useQecCampaignStore.getState().setCsvLoading(null);
  }
}

/** First file out of a drop/change event's FileList-ish, or null. */
export function firstFile(list: ArrayLike<File> | null | undefined): File | null {
  return list && list.length > 0 ? list[0] : null;
}
