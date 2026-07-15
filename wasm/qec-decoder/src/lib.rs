//! Interactive QEC syndrome decoder for Nuclei's detector-graph overlay — a
//! **sketch** of a net-new Rust/WASM feature (not a production decoder).
//!
//! # Why this exists (the design)
//!
//! Accurate, batch decoding already lives in the Python kernel via PyMatching /
//! fusion-blossom (native C++/Rust) driven by `sinter` campaigns — that stays
//! where it is. What the kernel path *can't* offer is **interactivity**: every
//! decode is a WebSocket round-trip, so you can't scrub a syndrome and watch the
//! matching update in real time.
//!
//! This crate is the complement: a small decoder compiled to WASM that runs
//! **in the webview**, so the detector-graph overlay can decode a hand-toggled
//! or freshly-sampled syndrome instantly (sub-millisecond, no round-trip). The
//! research value is exploratory — "what does the decoder do with *this*
//! syndrome, and would it cause a logical error?" — as a teaching/intuition
//! tool alongside the accurate campaign numbers.
//!
//! # What's implemented vs sketched
//!
//! Implemented + tested: the full data path — build the matching graph, all-
//! pairs shortest paths (Dijkstra) among defects and to the boundary, a
//! **greedy** minimum-weight matching, correction reconstruction, and the
//! predicted observable flips (XOR of the observable frame along the
//! correction). This is a *correct* decoder, just not an *optimal* one.
//!
//! The upgrade path (documented, not built): swap the greedy matcher for
//! blossom MWPM or a Delfosse–Nickerson **union-find** decoder (near-linear,
//! ideal for the interactive budget) — the graph build, path reconstruction,
//! and observable-frame accounting here are exactly what those need, so only
//! `match_defects` changes.

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use serde::{Deserialize, Serialize};

/// One matchable edge of the detector graph. `b == -1` is a boundary edge (to
/// the virtual boundary node). `weight` is the matching cost — typically
/// `-ln(p)` so likelier mechanisms are cheaper to traverse.
#[derive(Deserialize, Debug, Clone)]
pub struct InputEdge {
    pub a: i32,
    pub b: i32,
    pub weight: f64,
    #[serde(default)]
    pub obs: Vec<u32>,
}

#[derive(Deserialize, Debug)]
pub struct DecodeInput {
    pub num_detectors: u32,
    #[serde(default)]
    pub num_observables: u32,
    pub edges: Vec<InputEdge>,
    /// Indices of the fired (defect) detectors.
    pub syndrome: Vec<u32>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct MatchPair {
    pub a: i32,
    pub b: i32, // -1 = boundary
}

#[derive(Serialize, Debug)]
pub struct Decoded {
    /// Which defect paired with which (b = -1 for a boundary match).
    pub matched: Vec<MatchPair>,
    /// The detector-graph edges on the correction paths (for the overlay).
    pub correction_edges: Vec<MatchPair>,
    /// Predicted observable flips — the XOR of the observable frame along the
    /// correction. Comparing to the true flips (kernel-side) tells you whether
    /// this shot is a logical error.
    pub predicted_flips: Vec<bool>,
}

// A weighted adjacency edge: (neighbor, weight, edge_index).
type Adj = Vec<Vec<(usize, f64, usize)>>;

/// Build the adjacency list over `num_detectors + 1` nodes (last node = the
/// virtual boundary). Returns the adjacency and the edge table.
fn build_graph(input: &DecodeInput) -> (Adj, Vec<InputEdge>) {
    let boundary = input.num_detectors as usize;
    let n = boundary + 1;
    let mut adj: Adj = vec![Vec::new(); n];
    let edges = input.edges.clone();
    for (i, e) in edges.iter().enumerate() {
        let u = e.a as usize;
        let v = if e.b == -1 { boundary } else { e.b as usize };
        if u < n && v < n {
            adj[u].push((v, e.weight, i));
            adj[v].push((u, e.weight, i));
        }
    }
    (adj, edges)
}

#[derive(Clone, Copy)]
struct HeapItem {
    dist: f64,
    node: usize,
}
impl PartialEq for HeapItem {
    fn eq(&self, other: &Self) -> bool {
        self.dist == other.dist
    }
}
impl Eq for HeapItem {}
impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for HeapItem {
    // Reverse for a min-heap on distance.
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .dist
            .partial_cmp(&self.dist)
            .unwrap_or(Ordering::Equal)
    }
}

/// Dijkstra from `source`. Returns (dist, prev_edge) where prev_edge[v] is the
/// edge index used to reach v (usize::MAX at the source / unreached).
fn dijkstra(adj: &Adj, source: usize) -> (Vec<f64>, Vec<usize>) {
    let n = adj.len();
    let mut dist = vec![f64::INFINITY; n];
    let mut prev_edge = vec![usize::MAX; n];
    dist[source] = 0.0;
    let mut heap = BinaryHeap::new();
    heap.push(HeapItem { dist: 0.0, node: source });
    while let Some(HeapItem { dist: d, node: u }) = heap.pop() {
        if d > dist[u] {
            continue;
        }
        for &(v, w, ei) in &adj[u] {
            let nd = d + w;
            if nd < dist[v] {
                dist[v] = nd;
                prev_edge[v] = ei;
                heap.push(HeapItem { dist: nd, node: v });
            }
        }
    }
    (dist, prev_edge)
}

/// Greedy minimum-weight matching: repeatedly commit the cheapest available
/// pairing (defect↔defect or defect↔boundary), removing matched defects, until
/// every defect is matched. Correct (produces a valid correction) but not
/// optimal — see the crate docs for the MWPM / union-find upgrade.
fn match_defects(defects: &[usize], boundary: usize, pair_cost: &dyn Fn(usize, usize) -> f64, boundary_cost: &dyn Fn(usize) -> f64) -> Vec<(usize, i32)> {
    let mut unmatched: Vec<usize> = defects.to_vec();
    let mut result: Vec<(usize, i32)> = Vec::new();

    while !unmatched.is_empty() {
        // Best defect↔defect pair.
        let mut best: Option<(f64, usize, i32)> = None; // (cost, i-index, j-index-or-boundary)
        for i in 0..unmatched.len() {
            let bc = boundary_cost(unmatched[i]);
            consider(&mut best, bc, i, -1);
            for j in (i + 1)..unmatched.len() {
                let c = pair_cost(unmatched[i], unmatched[j]);
                consider(&mut best, c, i, j as i32);
            }
        }
        match best {
            Some((_, i, -1)) => {
                result.push((unmatched[i], -1));
                let _ = boundary; // boundary node index unused directly here
                unmatched.remove(i);
            }
            Some((_, i, j)) => {
                let ju = j as usize;
                let (lo, hi) = if i < ju { (i, ju) } else { (ju, i) };
                result.push((unmatched[lo], unmatched[hi] as i32));
                unmatched.remove(hi);
                unmatched.remove(lo);
            }
            None => break,
        }
    }
    result
}

fn consider(best: &mut Option<(f64, usize, i32)>, cost: f64, i: usize, j: i32) {
    if cost.is_finite() && best.map(|(c, _, _)| cost < c).unwrap_or(true) {
        *best = Some((cost, i, j));
    }
}

/// Decode a syndrome on the detector graph.
pub fn decode(input: &DecodeInput) -> Decoded {
    let (adj, edges) = build_graph(input);
    let boundary = input.num_detectors as usize;
    let defects: Vec<usize> = input
        .syndrome
        .iter()
        .map(|&d| d as usize)
        .filter(|&d| d < boundary)
        .collect();

    // All-pairs shortest paths from each defect (also gives distance to boundary).
    let sp: Vec<(Vec<f64>, Vec<usize>)> = defects.iter().map(|&d| dijkstra(&adj, d)).collect();
    let index_of = |node: usize| defects.iter().position(|&d| d == node);

    let pair_cost = |u: usize, v: usize| -> f64 {
        match index_of(u) {
            Some(iu) => sp[iu].0[v],
            None => f64::INFINITY,
        }
    };
    let boundary_cost = |u: usize| -> f64 {
        match index_of(u) {
            Some(iu) => sp[iu].0[boundary],
            None => f64::INFINITY,
        }
    };

    let matches = match_defects(&defects, boundary, &pair_cost, &boundary_cost);

    // Reconstruct the correction paths + accumulate the observable frame.
    let mut correction: Vec<MatchPair> = Vec::new();
    let mut flips = vec![false; input.num_observables as usize];
    let matched_out: Vec<MatchPair> = matches
        .iter()
        .map(|&(u, v)| {
            let target = if v == -1 { boundary } else { v as usize };
            if let Some(iu) = index_of(u) {
                reconstruct_path(&sp[iu].1, &edges, boundary, target, &mut correction, &mut flips);
            }
            MatchPair { a: u as i32, b: v }
        })
        .collect();

    Decoded {
        matched: matched_out,
        correction_edges: correction,
        predicted_flips: flips,
    }
}

/// Walk prev_edge pointers from `target` back to the source, collecting the
/// detector-pair edges and XORing their observable frame into `flips`.
fn reconstruct_path(
    prev_edge: &[usize],
    edges: &[InputEdge],
    boundary: usize,
    target: usize,
    correction: &mut Vec<MatchPair>,
    flips: &mut [bool],
) {
    let mut node = target;
    while prev_edge[node] != usize::MAX {
        let e = &edges[prev_edge[node]];
        correction.push(MatchPair { a: e.a, b: e.b });
        for &o in &e.obs {
            if (o as usize) < flips.len() {
                flips[o as usize] ^= true;
            }
        }
        // Step to the other endpoint of this edge.
        let u = e.a as usize;
        let v = if e.b == -1 { boundary } else { e.b as usize };
        node = if node == u { v } else { u };
    }
}

// ───────────────────────────── WASM boundary ─────────────────────────────

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::wasm_bindgen;

/// Decode a syndrome given a JSON `DecodeInput`; returns a JSON `Decoded`.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn decode_json(input_json: &str) -> String {
    match serde_json::from_str::<DecodeInput>(input_json) {
        Ok(input) => serde_json::to_string(&decode(&input)).unwrap_or_else(|_| "null".into()),
        Err(_) => "null".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge(a: i32, b: i32, w: f64, obs: Vec<u32>) -> InputEdge {
        InputEdge { a, b, weight: w, obs }
    }

    // A d=5 repetition-style chain: detectors 0-1-2-3 in a line, with boundary
    // edges off each end (0 and 3). Observable frame is carried by the boundary
    // edge on the right end.
    fn chain() -> DecodeInput {
        DecodeInput {
            num_detectors: 4,
            num_observables: 1,
            edges: vec![
                edge(0, -1, 1.0, vec![]),   // left boundary
                edge(0, 1, 1.0, vec![]),
                edge(1, 2, 1.0, vec![]),
                edge(2, 3, 1.0, vec![]),
                edge(3, -1, 1.0, vec![0]),  // right boundary carries observable 0
            ],
            syndrome: vec![],
        }
    }

    #[test]
    fn no_syndrome_no_correction() {
        let d = decode(&chain());
        assert!(d.matched.is_empty());
        assert!(d.correction_edges.is_empty());
        assert_eq!(d.predicted_flips, vec![false]);
    }

    #[test]
    fn adjacent_defects_match_each_other() {
        let mut input = chain();
        input.syndrome = vec![1, 2];
        let d = decode(&input);
        // The single cheapest match is 1↔2, correcting the edge between them.
        assert_eq!(d.matched, vec![MatchPair { a: 1, b: 2 }]);
        assert_eq!(d.correction_edges, vec![MatchPair { a: 1, b: 2 }]);
        assert_eq!(d.predicted_flips, vec![false]); // interior edge, no observable
    }

    #[test]
    fn lone_defect_matches_nearest_boundary() {
        let mut input = chain();
        input.syndrome = vec![3]; // one hop from the right (observable) boundary
        let d = decode(&input);
        assert_eq!(d.matched, vec![MatchPair { a: 3, b: -1 }]);
        // Correcting to the right boundary crosses the observable frame → a flip.
        assert_eq!(d.predicted_flips, vec![true]);
    }

    #[test]
    fn odd_parity_uses_the_boundary() {
        let mut input = chain();
        input.syndrome = vec![0, 1, 2]; // three defects → one must go to boundary
        let d = decode(&input);
        assert_eq!(d.matched.len(), 2);
        let boundary_matches = d.matched.iter().filter(|m| m.b == -1).count();
        assert_eq!(boundary_matches, 1);
    }

    #[test]
    fn json_roundtrip() {
        let mut input = chain();
        input.syndrome = vec![1, 2];
        let json = serde_json::to_string(&serde_json::json!({
            "num_detectors": input.num_detectors,
            "num_observables": input.num_observables,
            "edges": input.edges.iter().map(|e| serde_json::json!({"a": e.a, "b": e.b, "weight": e.weight, "obs": e.obs})).collect::<Vec<_>>(),
            "syndrome": input.syndrome,
        }))
        .unwrap();
        let parsed: DecodeInput = serde_json::from_str(&json).unwrap();
        let d = decode(&parsed);
        assert_eq!(d.matched, vec![MatchPair { a: 1, b: 2 }]);
    }
}
