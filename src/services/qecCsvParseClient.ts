import { prepareSinterCsv, type PreparedCsv } from './qecCsvPrepare';

/** Below this many characters parsing is quick enough to stay on the main thread. */
export const OFF_THREAD_MIN_CHARS = 256 * 1024;

export interface CsvWorkerLike {
  postMessage(message: { id: number; text: string }): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  terminate(): void;
}

export type CsvWorkerFactory = () => CsvWorkerLike;

/** The Vite worker pattern; unavailable where Worker is missing (jsdom, some webviews). */
function defaultFactory(): CsvWorkerFactory | null {
  if (typeof Worker === 'undefined') return null;
  return () => new Worker(new URL('./qecCsvParse.worker.ts', import.meta.url), { type: 'module' }) as unknown as CsvWorkerLike;
}

let nextRequestId = 1;

/**
 * Parse and prepare a sinter stats CSV (validate, guess the mapping, fold replicates, serialize)
 * without freezing the UI: big files go to a short-lived worker; small files
 * and any worker failure parse inline, so the result is always the same.
 */
export function prepareSinterCsvOffThread(
  text: string,
  factory: CsvWorkerFactory | null = defaultFactory(),
): Promise<PreparedCsv> {
  if (!factory || text.length < OFF_THREAD_MIN_CHARS) return Promise.resolve(prepareSinterCsv(text));
  return new Promise<PreparedCsv>((resolve) => {
    let worker: CsvWorkerLike;
    try {
      worker = factory();
    } catch {
      resolve(prepareSinterCsv(text));
      return;
    }
    const id = nextRequestId++;
    const finish = (result: () => PreparedCsv): void => {
      worker.terminate();
      resolve(result());
    };
    worker.onmessage = (event) => {
      const data = event.data as { id?: number; result?: PreparedCsv };
      if (data.id === id && data.result) finish(() => data.result as PreparedCsv);
    };
    worker.onerror = () => finish(() => prepareSinterCsv(text));
    worker.postMessage({ id, text });
  });
}
