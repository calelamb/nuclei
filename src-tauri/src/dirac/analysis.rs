//! Pure, side-effect-free quantum-program analysis (Stage R3 port of
//! `src/services/agent/{analysis.ts, algorithms.ts, hardwarePlanner.ts}`).
//! No kernel access, no I/O — every function in this module tree is a plain
//! deterministic transform over a [`CircuitSnapshot`] (or, for the planner,
//! also a set of [`planner::BackendInfo`]).
//!
//! Split by concern, mirroring the TS module boundaries:
//! - [`resources`] — resource estimation (`estimate_resources`).
//! - [`validate`] — structural/semantic validators (`validate_program`) and
//!   distribution comparison (`compare_distributions`).
//! - [`algorithms`] — canonical algorithm classification and reference
//!   distributions.
//! - [`planner`] — hardware backend filtering/scoring/planning (shadow mode
//!   only: nothing here submits a job or talks to a provider).
//!
//! `CircuitSnapshot`/`Gate` live in this top-level file (rather than any one
//! submodule) because they are the shared input model every submodule
//! analyzes; they mirror the kernel's JSON `CircuitSnapshot`/`Gate` (see
//! `kernel/models/snapshot.py` and the `CircuitSnapshot` shape documented in
//! the top-level `CLAUDE.md`).
//!
//! Stage R4's orchestrator is the first live caller of this module; until
//! then it is exercised only by its own unit tests. The allow below covers
//! both the not-yet-called functions and the re-exports below (which have
//! no live caller yet either) — every path already has a unit test in this
//! module or its submodules.
#![allow(dead_code, unused_imports)] // remove-me: wired up by the Stage R4 orchestrator.

pub mod algorithms;
pub mod planner;
pub mod resources;
pub mod validate;

pub use algorithms::{
    classify_algorithm, expected_distribution, AlgorithmClassification, AlgorithmKind, Confidence,
};
pub use planner::{
    filter_compatible, plan_hardware_run, score_backend, BackendInfo, BackendScore,
    CompatibilityResult, HardwarePlan, HardwarePlanCandidate, HardwarePlanRejected, ScoreFactor,
};
pub use resources::{estimate_resources, ResourceEstimate};
pub use validate::{
    compare_distributions, ComparisonPerState, ComparisonReport, Diagnostic, DiagnosticSeverity,
};

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A single gate in a parsed circuit, matching the kernel's JSON shape.
///
/// `targets`/`controls` are signed (`i64`) rather than the kernel's natural
/// unsigned qubit index because the validators in [`validate`] must be able
/// to represent and flag an out-of-range **negative** index from a
/// malformed/adversarial snapshot (see `check_qubit_range`'s negative-index
/// test) — the same reason the TS `number[]` was left unconstrained.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Gate {
    #[serde(rename = "type")]
    pub gate_type: String,
    pub targets: Vec<i64>,
    pub controls: Vec<i64>,
    pub params: Vec<f64>,
    pub layer: u32,
}

/// A parsed circuit snapshot, matching the kernel's JSON shape (sent on
/// every code change; see `CircuitSnapshot` in the top-level `CLAUDE.md`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircuitSnapshot {
    pub framework: String,
    pub qubit_count: u32,
    pub classical_bit_count: u32,
    pub depth: u32,
    pub gates: Vec<Gate>,
}

/// Regex-free port of the TS `MEASUREMENT_TYPE_RE = /^(measure|m|mz|mresetz)$/i`.
pub(crate) fn is_measurement_type(gate_type: &str) -> bool {
    matches!(
        gate_type.to_uppercase().as_str(),
        "MEASURE" | "M" | "MZ" | "MRESETZ"
    )
}

/// Distinct qubit indices a gate touches (targets ∪ controls).
pub(crate) fn involved_qubit_count(gate: &Gate) -> usize {
    let set: HashSet<i64> = gate
        .targets
        .iter()
        .chain(gate.controls.iter())
        .copied()
        .collect();
    set.len()
}
