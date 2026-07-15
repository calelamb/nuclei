/**
 * Optional WASM accelerator for the QEC detector graph. Lazy-loads the
 * `wasm/qec-dem` module (built on demand by `npm run build:wasm`); when it's
 * absent — the default — `parseDemGraphWasm` returns `null` and callers fall
 * back to the kernel-supplied graph. This keeps the frontend build and runtime
 * working with or without the wasm artifact, so nothing on the release path
 * depends on the Rust toolchain.
 *
 * See `wasm/README.md` for how to build it and the (deliberately deferred)
 * protocol change to feed it `str(dem)` from the kernel.
 */

export interface DemDetectorGraph {
  edge_count: number;
  boundary_edge_count: number;
  hyperedges_count: number;
  truncated: boolean;
  edges: Array<{ d1: number; d2: number; obs: number[]; p: number }>;
  boundary_edges: Array<{ d: number; obs: number[]; p: number }>;
}

interface DemWasmModule {
  default?: (input?: unknown) => Promise<unknown>;
  parse_dem: (demText: string, maxEdges: number) => string;
}

// `undefined` = not yet attempted, `null` = attempted and unavailable.
let cached: DemWasmModule | null | undefined;

async function loadWasm(): Promise<DemWasmModule | null> {
  if (cached !== undefined) return cached;
  try {
    // Variable path + @vite-ignore so the bundler never tries to resolve the
    // (usually absent) pkg at build time — it's a pure runtime import.
    const path = '../../wasm/qec-dem/pkg/qec_dem.js';
    const mod = (await import(/* @vite-ignore */ path)) as DemWasmModule;
    if (typeof mod.default === 'function') await mod.default(); // wasm-pack init
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Parse a flattened Stim DEM text into the detector-graph payload using the
 * WASM parser. Resolves `null` when the wasm module isn't built (the caller
 * should then use the graph the kernel already sent).
 */
export async function parseDemGraphWasm(
  demText: string,
  maxEdges = 5000,
): Promise<DemDetectorGraph | null> {
  const mod = await loadWasm();
  if (!mod) return null;
  try {
    return JSON.parse(mod.parse_dem(demText, maxEdges)) as DemDetectorGraph;
  } catch {
    return null;
  }
}

/** Test seam: reset the module cache. */
export function __resetDemWasmCacheForTest(): void {
  cached = undefined;
}
