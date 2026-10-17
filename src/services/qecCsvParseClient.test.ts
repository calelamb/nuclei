import { describe, it, expect, vi } from 'vitest';
import { prepareSinterCsvOffThread, OFF_THREAD_MIN_CHARS, type CsvWorkerFactory, type CsvWorkerLike } from './qecCsvParseClient';
import type { PreparedCsv } from './qecCsvPrepare';

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const small = [HEADER, '100,1,0,1,pymatching,a,"{""d"":3,""p"":0.01}",'].join('\n');
const big = `${small}\n${' '.repeat(OFF_THREAD_MIN_CHARS)}`;
const fromWorker: PreparedCsv = { parsed: { rows: [], issues: [], fatal: 'from worker', totalDataRows: 0, rejectedRows: 0 }, prepared: null };

function fakeWorker(reply: (msg: { id: number; text: string }) => unknown, mode: 'ok' | 'error' = 'ok') {
  const worker: CsvWorkerLike & { terminated: boolean; posted: unknown[] } = {
    terminated: false, posted: [], onmessage: null, onerror: null,
    postMessage(msg) {
      this.posted.push(msg);
      queueMicrotask(() => {
        if (mode === 'error') this.onerror?.(new Event('error'));
        else this.onmessage?.({ data: reply(msg as { id: number; text: string }) } as MessageEvent);
      });
    },
    terminate() { this.terminated = true; },
  };
  return worker;
}

describe('prepareSinterCsvOffThread', () => {
  it('parses small files inline without starting a worker', async () => {
    const factory = vi.fn<CsvWorkerFactory>();
    const result = await prepareSinterCsvOffThread(small, factory);
    expect(factory).not.toHaveBeenCalled();
    expect(result.parsed.fatal).toBeNull();
    expect(result.parsed.rows).toHaveLength(1);
    expect(result.prepared?.mapped).toHaveLength(1);
    expect(result.prepared?.statsCsv).toContain('strong_id');
  });

  it('hands big files to a worker and ends it afterwards', async () => {
    const worker = fakeWorker((msg) => ({ id: msg.id, result: fromWorker }));
    const result = await prepareSinterCsvOffThread(big, () => worker);
    expect(result).toEqual(fromWorker);
    expect(worker.posted).toHaveLength(1);
    expect(worker.terminated).toBe(true);
  });

  it('ignores replies for another request', async () => {
    const worker = fakeWorker((msg) => ({ id: msg.id + 1, result: fromWorker }));
    const pending = prepareSinterCsvOffThread(big, () => worker);
    const winner = await Promise.race([pending.then(() => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 20))]);
    expect(winner).toBe('waiting');
    worker.terminate();
  });

  it('falls back to parsing inline when the worker fails or cannot start', async () => {
    const failing = fakeWorker(() => null, 'error');
    const viaError = await prepareSinterCsvOffThread(big, () => failing);
    expect(viaError.parsed.fatal).not.toBe('from worker');
    expect(failing.terminated).toBe(true);
    const viaThrow = await prepareSinterCsvOffThread(big, () => { throw new Error('no workers'); });
    expect(viaThrow.parsed.fatal).not.toBe('from worker');
  });

  it('falls back inline when no worker factory exists (jsdom, old webviews)', async () => {
    const result = await prepareSinterCsvOffThread(big, null);
    expect(result.parsed.fatal).not.toBe('from worker');
  });
});
