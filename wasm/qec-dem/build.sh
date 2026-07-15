#!/usr/bin/env bash
# Build the QEC DEM parser to WASM for the frontend. Optional — the app runs
# without it (falls back to the kernel-supplied detector graph). NOT part of the
# release build, so it can never break the signed .dmg/.msi/.AppImage pipeline.
#
# Requires wasm-pack (`cargo install wasm-pack`). Emits an ESM package into pkg/.
set -euo pipefail
cd "$(dirname "$0")"
wasm-pack build --release --target web --out-dir pkg --features wasm
echo "Built wasm/qec-dem/pkg — import { parse_dem } from it (see src/lib/qecDemWasm.ts)."
