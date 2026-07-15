import { describe, expect, it, beforeEach } from 'vitest';
import { decodeSyndrome, isDecoderAvailable, __resetDecoderWasmForTest } from './qecDecoderWasm';

describe('qecDecoderWasm graceful fallback', () => {
  beforeEach(() => __resetDecoderWasmForTest());

  // In jsdom/node the wasm module can't initialize (no fetch of the .wasm
  // asset), so the loader must degrade to null rather than throw — the panel
  // then simply hides the interactive toggle. The compiled wasm itself is
  // verified in wasm/qec-decoder (cargo tests + a Node-target smoke run).
  it('resolves null from decodeSyndrome when the wasm is unavailable', async () => {
    const result = await decodeSyndrome({
      num_detectors: 2,
      num_observables: 1,
      edges: [{ a: 0, b: 1, weight: 1, obs: [] }],
      syndrome: [0, 1],
    });
    expect(result).toBeNull();
  });

  it('reports the decoder as unavailable', async () => {
    await expect(isDecoderAvailable()).resolves.toBe(false);
  });
});
