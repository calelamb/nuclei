/**
 * Loads the `qec-decoder` WASM module (built + committed under
 * `wasm/qec-decoder/pkg`) and exposes an async `decodeSyndrome`. The module is
 * lazy-loaded and initialized once; if it ever fails to load, the call resolves
 * `null` and the UI degrades gracefully (interactive decode is simply
 * unavailable — the kernel "Sample a shot" path is untouched).
 *
 * This is the *interactive* decoder: it runs in the webview so the detector
 * graph can re-decode a hand-toggled syndrome instantly, with no kernel
 * round-trip. Accurate campaign decoding stays in the kernel (PyMatching).
 */

export interface DecodeInputEdge {
  a: number;
  b: number; // -1 = boundary
  weight: number;
  obs: number[];
}

export interface DecodeInput {
  num_detectors: number;
  num_observables: number;
  edges: DecodeInputEdge[];
  syndrome: number[];
}

export interface DecodedResult {
  matched: Array<{ a: number; b: number }>;
  correction_edges: Array<{ a: number; b: number }>;
  predicted_flips: boolean[];
}

interface DecoderModule {
  default: (input?: unknown) => Promise<unknown>;
  decode_json: (inputJson: string) => string;
}

let modulePromise: Promise<DecoderModule | null> | undefined;

async function loadModule(): Promise<DecoderModule | null> {
  if (modulePromise === undefined) {
    modulePromise = (async () => {
      try {
        const mod = (await import('../../wasm/qec-decoder/pkg/qec_decoder.js')) as unknown as DecoderModule;
        await mod.default(); // wasm-bindgen init (fetches the .wasm asset)
        return mod;
      } catch {
        return null;
      }
    })();
  }
  return modulePromise;
}

/** True once the wasm module has loaded successfully (for gating UI). */
export async function isDecoderAvailable(): Promise<boolean> {
  return (await loadModule()) !== null;
}

/** Decode a syndrome on the detector graph. Resolves `null` if the wasm module
 * is unavailable or the input can't be decoded. */
export async function decodeSyndrome(input: DecodeInput): Promise<DecodedResult | null> {
  const mod = await loadModule();
  if (!mod) return null;
  try {
    const out = mod.decode_json(JSON.stringify(input));
    const parsed = JSON.parse(out) as DecodedResult | null;
    return parsed ?? null;
  } catch {
    return null;
  }
}

/** Test seam. */
export function __resetDecoderWasmForTest(): void {
  modulePromise = undefined;
}
