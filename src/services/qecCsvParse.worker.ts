/// <reference lib="webworker" />
import { prepareSinterCsv } from './qecCsvPrepare';

/** Parses and prepares a sinter stats CSV off the main thread; see qecCsvParseClient.ts. */
self.onmessage = (event: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = event.data;
  self.postMessage({ id, result: prepareSinterCsv(text) });
};
