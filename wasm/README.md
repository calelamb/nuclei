# WASM crates

Optional Rust→WebAssembly accelerators for the frontend. **None of this is on
the critical build path** — the app builds and ships (signed `.dmg`/`.msi`/
`.AppImage`) with these unbuilt, and each has a graceful JS fallback. Build a
crate only when you want the acceleration.

## `qec-dem` — detector-error-model text parser

Parses a flattened Stim DEM's *text* form into the QEC detector-graph payload
(pairwise edges, boundary edges, hyperedge count, truncation flag). It's a
direct port of `kernel/qec/dem.py::extract_detector_graph` and is verified
**byte-identical** to it (`cargo test` + a cross-language diff on surface d5/d7
and repetition d9).

Why it exists: the DEM→graph transform is the QEC live-edit path's one genuine
CPU cost. Step 1 was making the **Python** side parse text instead of walking
the live Stim object (already ~2.6× — see `perf(qec): parse DEM text…`). This
crate is step 2: reclaim the residual (the Python string-parse itself) by doing
it in Rust/WASM in the webview, so the kernel can forward `str(dem)` and the
frontend parses it.

### Build (optional)

```bash
cargo install wasm-pack        # once
npm run build:wasm             # or: wasm/qec-dem/build.sh
```

This emits `wasm/qec-dem/pkg/` (gitignored). `src/lib/qecDemWasm.ts` lazy-loads
it; if `pkg/` is absent, `parseDemGraphWasm` returns `null` and the caller uses
the kernel-supplied graph — no error, no behavior change.

### Test / verify

```bash
cd wasm/qec-dem
cargo test                                     # native unit tests
cargo build --target wasm32-unknown-unknown --features wasm --release   # wasm compiles
```

### Wiring it live (not done here — a deliberate follow-up)

Using it end-to-end means a small kernel-protocol change: have `qec_snapshot`
forward `str(dem.flattened())` instead of (or alongside) the parsed graph, then
call `parseDemGraphWasm` in `DetectorGraphPanel`. That moves bytes to the client
and is worth doing only if profiling shows the residual Python parse still
matters after the step-1 win. The crate + loader are the ready building blocks.
