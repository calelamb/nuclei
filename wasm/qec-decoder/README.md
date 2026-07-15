# `qec-decoder` — interactive in-webview syndrome decoder (SKETCH)

A **net-new** Rust/WASM feature sketch — not a refactor, and not a production
decoder. It's a compiling, tested skeleton showing what an *interactive* QEC
decoder in the webview would look like, and where it fits.

## The idea

Accurate, batch decoding already lives in the Python kernel: PyMatching /
fusion-blossom (native C++/Rust) driven by `sinter` campaigns. That's the right
place for the numbers a researcher publishes, and it stays there.

What that path **can't** give you is interactivity. Every decode is a WebSocket
round-trip to the kernel, so you can't grab a syndrome, toggle a detector, and
watch the matching re-solve in real time. This crate is the complement: a small
decoder compiled to WASM that runs **in the webview**, decoding a hand-toggled
or freshly-sampled syndrome **instantly** (sub-millisecond, no round-trip).

The value is exploratory and pedagogical — *"what does the decoder do with **this**
syndrome, and would it be a logical error?"* — shown live on the detector-graph
overlay, next to (not instead of) the accurate campaign statistics.

## How it plugs in

The detector graph already has everything: `DetectorGraphPanel` renders the
graph and a "Sample a shot" overlay that today calls the kernel
(`qec_decode_sample`). The interactive path would instead:

1. Take the graph the panel already has (`detectorGraphLayout` — nodes + edges +
   `p`/`obs`), convert edge weights to `-ln(p)`, and pass it with the current
   syndrome to `decode_json`.
2. Render `matched` + `correction_edges` on the overlay (the panel already
   styles a matching), and show `predicted_flips` → "logical error this shot?".
3. Let the user **click detectors to toggle the syndrome** and re-decode on each
   change — the interaction the kernel round-trip can't afford.

No kernel/protocol change is required for the interactive path; it reads data
the frontend already holds.

## What's implemented vs sketched

**Implemented + tested** (`cargo test`, 5 tests; also compiles to
`wasm32-unknown-unknown`): the whole data path — build the matching graph,
all-pairs shortest paths (Dijkstra) among defects and to the virtual boundary,
a **greedy** minimum-weight matching, correction-path reconstruction, and the
predicted observable flips (XOR of the observable frame along the correction).
It is a *correct* decoder — it always returns a valid correction — just not an
*optimal* one.

**The upgrade path** (documented, not built): replace the greedy matcher with
- **blossom MWPM** for optimal minimum-weight perfect matching, or
- a **Delfosse–Nickerson union-find** decoder — near-linear, which is the sweet
  spot for the interactive latency budget.

Both need exactly what's already here (the weighted graph, path reconstruction,
observable-frame accounting); only `match_defects` changes. That's the point of
the sketch: prove the shape and the boundary with PyMatching, so the accurate
decoder stays in the kernel and only the *interactive* one lives in WASM.

## Build / test

```bash
cd wasm/qec-decoder
cargo test                                                            # native
cargo build --target wasm32-unknown-unknown --features wasm --release # wasm
```
