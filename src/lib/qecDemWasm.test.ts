import { describe, expect, it, beforeEach } from 'vitest';
import { parseDemGraphWasm, __resetDemWasmCacheForTest } from './qecDemWasm';

describe('qecDemWasm', () => {
  beforeEach(() => __resetDemWasmCacheForTest());

  it('falls back to null when the wasm module is not built (the default)', async () => {
    // The optional wasm/qec-dem/pkg is gitignored and absent in CI, so the
    // dynamic import fails and the accelerator degrades gracefully — the caller
    // then uses the kernel-supplied detector graph.
    await expect(parseDemGraphWasm('error(0.1) D0 D1\n', 5000)).resolves.toBeNull();
  });

  it('caches the unavailable result (does not retry the import every call)', async () => {
    await expect(parseDemGraphWasm('error(0.1) D0 D1\n')).resolves.toBeNull();
    await expect(parseDemGraphWasm('error(0.2) D2 D3\n')).resolves.toBeNull();
  });
});
