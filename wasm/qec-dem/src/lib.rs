//! Fast Stim detector-error-model (DEM) text parser for Nuclei's QEC detector
//! graph, compiled to WebAssembly.
//!
//! Stim emits a flattened DEM as text natively; this crate turns that text into
//! the detector-graph payload the frontend renders — pairwise edges, boundary
//! edges (to the virtual boundary node), an honest hyperedge count, and the
//! render-cap truncation flag. It is a straight port of
//! `kernel/qec/dem.py::extract_detector_graph`, so the WASM path and the
//! Python path produce the same graph; the frontend supplies `num_detectors`
//! (which the DEM text alone doesn't carry) alongside this output.
//!
//! Native `cargo test` exercises the parser without any wasm toolchain; the
//! `wasm` feature adds the wasm-bindgen entry point for the browser/webview.

use std::collections::BTreeSet;
use std::collections::HashMap;

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Edge {
    pub d1: u32,
    pub d2: u32,
    pub obs: Vec<u32>,
    pub p: f64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct BoundaryEdge {
    pub d: u32,
    pub obs: Vec<u32>,
    pub p: f64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DetectorGraph {
    pub edge_count: usize,
    pub boundary_edge_count: usize,
    pub hyperedges_count: usize,
    pub truncated: bool,
    pub edges: Vec<Edge>,
    pub boundary_edges: Vec<BoundaryEdge>,
}

/// Probability that an odd number of two independent mechanisms fire — the
/// standard XOR combination PyMatching applies when merging parallel edges.
fn xor_combine(p_old: f64, p_new: f64) -> f64 {
    p_old * (1.0 - p_new) + p_new * (1.0 - p_old)
}

/// Match Python's `round(p, 12)` closely enough for a render weight.
fn round12(p: f64) -> f64 {
    (p * 1e12).round() / 1e12
}

type EdgeStore = HashMap<(u32, u32), (f64, BTreeSet<u32>)>;
type BoundaryStore = HashMap<u32, (f64, BTreeSet<u32>)>;

fn add<K: std::cmp::Eq + std::hash::Hash>(
    store: &mut HashMap<K, (f64, BTreeSet<u32>)>,
    key: K,
    p: f64,
    obs: &BTreeSet<u32>,
) {
    match store.get_mut(&key) {
        Some((old_p, old_obs)) => {
            *old_p = xor_combine(*old_p, p);
            old_obs.extend(obs.iter().copied());
        }
        None => {
            store.insert(key, (p, obs.clone()));
        }
    }
}

/// Parse a flattened DEM's text into the detector-graph payload. `max_edges`
/// caps the payload: above it, the edge lists are dropped and `truncated` is
/// set (the counts always survive — never a silently-missing graph).
pub fn parse_detector_graph(dem_text: &str, max_edges: usize) -> DetectorGraph {
    let mut edges: EdgeStore = HashMap::new();
    let mut boundary: BoundaryStore = HashMap::new();
    let mut hyperedges = 0usize;

    for line in dem_text.lines() {
        if !line.starts_with("error(") {
            continue;
        }
        let close = match line.find(')') {
            Some(i) => i,
            None => continue,
        };
        let p: f64 = match line[6..close].parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        // Targets follow ") "; split each `^`-separated component.
        let rest = line.get(close + 2..).unwrap_or("");
        for comp in rest.split(" ^ ") {
            let mut dets: Vec<u32> = Vec::new();
            let mut obs: BTreeSet<u32> = BTreeSet::new();
            for tok in comp.split_whitespace() {
                let (head, num) = tok.split_at(1);
                match head {
                    "D" => {
                        if let Ok(v) = num.parse() {
                            dets.push(v);
                        }
                    }
                    "L" => {
                        if let Ok(v) = num.parse() {
                            obs.insert(v);
                        }
                    }
                    _ => {}
                }
            }
            match dets.len() {
                2 => {
                    let key = if dets[0] <= dets[1] {
                        (dets[0], dets[1])
                    } else {
                        (dets[1], dets[0])
                    };
                    add(&mut edges, key, p, &obs);
                }
                1 => add(&mut boundary, dets[0], p, &obs),
                n if n > 2 => hyperedges += 1,
                _ => {} // 0 detectors (pure observable flip): no graph element
            }
        }
    }

    let total = edges.len() + boundary.len();
    let truncated = total > max_edges;

    let (edge_list, boundary_list) = if truncated {
        (Vec::new(), Vec::new())
    } else {
        let mut ekeys: Vec<_> = edges.keys().copied().collect();
        ekeys.sort_unstable();
        let edge_list: Vec<Edge> = ekeys
            .into_iter()
            .map(|k| {
                let (p, obs) = &edges[&k];
                Edge {
                    d1: k.0,
                    d2: k.1,
                    obs: obs.iter().copied().collect(),
                    p: round12(*p),
                }
            })
            .collect();

        let mut bkeys: Vec<_> = boundary.keys().copied().collect();
        bkeys.sort_unstable();
        let boundary_list: Vec<BoundaryEdge> = bkeys
            .into_iter()
            .map(|k| {
                let (p, obs) = &boundary[&k];
                BoundaryEdge {
                    d: k,
                    obs: obs.iter().copied().collect(),
                    p: round12(*p),
                }
            })
            .collect();
        (edge_list, boundary_list)
    };

    DetectorGraph {
        edge_count: edges.len(),
        boundary_edge_count: boundary.len(),
        hyperedges_count: hyperedges,
        truncated,
        edges: edge_list,
        boundary_edges: boundary_list,
    }
}

/// Parse and serialize to JSON in one call — the shape the WASM boundary and
/// the tests both use.
pub fn parse_to_json(dem_text: &str, max_edges: usize) -> String {
    serde_json::to_string(&parse_detector_graph(dem_text, max_edges))
        .unwrap_or_else(|_| "null".to_string())
}

// ───────────────────────────── WASM boundary ─────────────────────────────

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::wasm_bindgen;

/// Parse a flattened DEM text into the detector-graph payload as a JSON string.
/// The caller (frontend) merges `num_detectors` from the snapshot.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn parse_dem(dem_text: &str, max_edges: u32) -> String {
    parse_to_json(dem_text, max_edges as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
error(0.1) D0 D1
error(0.05) D1 D2
error(0.05) D1 D2
error(0.2) D0
error(0.1) D2 D3 ^ D4 L0
detector(1, 0, 0) D0
";

    #[test]
    fn counts_and_merging() {
        let g = parse_detector_graph(SAMPLE, 5000);
        // (0,1), (1,2), (2,3) are the three pairwise edges.
        assert_eq!(g.edge_count, 3);
        // D0 and D4 are boundary edges.
        assert_eq!(g.boundary_edge_count, 2);
        assert_eq!(g.hyperedges_count, 0);
        assert!(!g.truncated);
    }

    #[test]
    fn parallel_edges_xor_merge() {
        let g = parse_detector_graph(SAMPLE, 5000);
        let e12 = g.edges.iter().find(|e| e.d1 == 1 && e.d2 == 2).unwrap();
        // 0.05 XOR 0.05 = 0.05*(0.95) + 0.05*(0.95) = 0.095
        assert!((e12.p - 0.095).abs() < 1e-12, "got {}", e12.p);
    }

    #[test]
    fn separator_splits_components_and_keeps_observables() {
        let g = parse_detector_graph(SAMPLE, 5000);
        // The `^` line contributes edge (2,3) and boundary D4 carrying obs L0.
        assert!(g.edges.iter().any(|e| e.d1 == 2 && e.d2 == 3));
        let b4 = g.boundary_edges.iter().find(|b| b.d == 4).unwrap();
        assert_eq!(b4.obs, vec![0]);
    }

    #[test]
    fn edges_and_boundary_are_sorted() {
        let g = parse_detector_graph(SAMPLE, 5000);
        let mut sorted = g.edges.iter().map(|e| (e.d1, e.d2)).collect::<Vec<_>>();
        let orig = sorted.clone();
        sorted.sort_unstable();
        assert_eq!(orig, sorted);
    }

    #[test]
    fn truncation_drops_lists_keeps_counts() {
        let g = parse_detector_graph(SAMPLE, 1);
        assert!(g.truncated);
        assert!(g.edges.is_empty());
        assert!(g.boundary_edges.is_empty());
        assert_eq!(g.edge_count, 3);
        assert_eq!(g.boundary_edge_count, 2);
    }

    #[test]
    fn hyperedges_are_counted_not_drawn() {
        let g = parse_detector_graph("error(0.1) D0 D1 D2\n", 5000);
        assert_eq!(g.hyperedges_count, 1);
        assert_eq!(g.edge_count, 0);
    }

    #[test]
    fn ignores_non_error_lines() {
        let g = parse_detector_graph("detector(1,0) D0\nlogical_observable L0\n", 5000);
        assert_eq!(g.edge_count, 0);
        assert_eq!(g.boundary_edge_count, 0);
    }
}
