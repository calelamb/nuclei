//! Pure, side-effect-free hardware planner (port of
//! `src/services/agent/hardwarePlanner.ts`). Given a parsed circuit and the
//! set of backends the app currently knows about, recommends a compatible
//! backend with an explainable, weighted score. SHADOW MODE ONLY: nothing
//! here submits a job, talks to a provider, or calls the kernel — it is
//! analysis over data already in hand.

use std::cmp::Ordering;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::CircuitSnapshot;

/// A hardware backend the app currently knows about (port of
/// `src/types/hardware.ts::BackendInfo`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackendInfo {
    pub name: String,
    pub provider: String,
    pub qubit_count: u32,
    pub connectivity: Vec<(u32, u32)>,
    pub queue_length: u32,
    pub average_error_rate: f64,
    pub gate_set: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompatibilityResult {
    pub backend: BackendInfo,
    pub compatible: bool,
    pub reasons: Vec<String>,
}

/// Measurement and barrier operations are considered universally available —
/// every backend that can run gates can also measure and place barriers, so
/// flagging them as "unsupported" would only produce false rejections.
fn is_always_available(gate_type: &str) -> bool {
    matches!(
        gate_type.to_uppercase().as_str(),
        "MEASURE" | "M" | "MZ" | "MRESETZ" | "BARRIER"
    )
}

/// Canonical gate-name synonyms so a backend that advertises one spelling
/// (e.g. `cx`) is correctly recognized as covering the other (e.g. `CNOT`).
const GATE_SYNONYM_GROUPS: &[&[&str]] = &[&["CNOT", "CX"], &["TOFFOLI", "CCX"], &["PHASE", "P"]];

fn equivalent_gate_names(gate_type: &str) -> Vec<String> {
    let upper = gate_type.to_uppercase();
    for group in GATE_SYNONYM_GROUPS {
        if group.contains(&upper.as_str()) {
            return group.iter().map(|s| s.to_string()).collect();
        }
    }
    vec![upper]
}

/// Distinct canonical (uppercased) gate types used by the circuit, excluding
/// measurement/barrier operations which are always considered available.
fn used_gate_types(snapshot: &CircuitSnapshot) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut types = Vec::new();
    for gate in &snapshot.gates {
        if is_always_available(&gate.gate_type) {
            continue;
        }
        let upper = gate.gate_type.to_uppercase();
        if seen.insert(upper.clone()) {
            types.push(upper);
        }
    }
    types
}

/// Gate-set coverage reasons. Conservative by design: an empty/unknown
/// gate_set never produces a rejection — only a backend that explicitly
/// advertises a gate set AND clearly lacks a used gate is flagged.
fn gate_set_reasons(snapshot: &CircuitSnapshot, backend: &BackendInfo) -> Vec<String> {
    if backend.gate_set.is_empty() {
        return Vec::new();
    }

    let advertised: HashSet<String> = backend.gate_set.iter().map(|g| g.to_uppercase()).collect();
    let mut reasons = Vec::new();

    for used in used_gate_types(snapshot) {
        let covered = equivalent_gate_names(&used)
            .iter()
            .any(|name| advertised.contains(name));
        if !covered {
            reasons.push(format!(
                "gate {used} is not in this backend's advertised gate set"
            ));
        }
    }

    reasons
}

/// Hard-filters backends against a parsed circuit: qubit count, online
/// status, and gate-set coverage. Every rejection carries a plain-English
/// reason so the caller (and the model) can explain the decision.
pub fn filter_compatible(
    snapshot: &CircuitSnapshot,
    backends: &[BackendInfo],
) -> Vec<CompatibilityResult> {
    backends
        .iter()
        .map(|backend| {
            let mut reasons = Vec::new();

            if backend.qubit_count < snapshot.qubit_count {
                reasons.push(format!(
                    "needs {} qubits, backend has {}",
                    snapshot.qubit_count, backend.qubit_count
                ));
            }
            if backend.status != "online" {
                reasons.push(format!("backend is {}", backend.status));
            }
            reasons.extend(gate_set_reasons(snapshot, backend));

            CompatibilityResult {
                backend: backend.clone(),
                compatible: reasons.is_empty(),
                reasons,
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoreFactor {
    pub name: String,
    pub value: f64,
    pub weight: f64,
    pub contribution: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackendScore {
    pub score: f64,
    pub factors: Vec<ScoreFactor>,
}

// Named weights for each scoring factor. Sum to 1.0 so `score` reads as a
// weighted-average style number in roughly [0, 1] (contributions are rounded
// individually, so the total may drift by a fraction of a rounding unit).
pub const QUEUE_WEIGHT: f64 = 0.35;
pub const ERROR_RATE_WEIGHT: f64 = 0.35;
pub const QUBIT_HEADROOM_WEIGHT: f64 = 0.2;
pub const STATUS_WEIGHT: f64 = 0.1;

// Saturation constants: how quickly each raw metric's normalized factor
// approaches its limit.
const QUEUE_SATURATION: f64 = 20.0; // queue_length at which the queue factor is 0.5
const QUBIT_HEADROOM_SATURATION: f64 = 4.0; // spare qubits at which the headroom factor is 0.5

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn round4(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}

/// Lower queue length is better; saturates toward 1 as the queue shortens
/// and decays toward 0 as it grows, never going negative.
fn queue_factor(queue_length: u32) -> f64 {
    QUEUE_SATURATION / (QUEUE_SATURATION + f64::from(queue_length))
}

/// Lower error rate is better. `average_error_rate` is expected in [0, 1];
/// the factor is clamped defensively in case of out-of-range input.
fn error_rate_factor(average_error_rate: f64) -> f64 {
    clamp01(1.0 - average_error_rate)
}

/// More spare qubits (beyond what the circuit needs) is better, saturating
/// so a backend with vastly more qubits than needed doesn't dominate purely
/// on headroom.
fn qubit_headroom_factor(snapshot: &CircuitSnapshot, backend: &BackendInfo) -> f64 {
    let spare = f64::from(backend.qubit_count.saturating_sub(snapshot.qubit_count));
    spare / (spare + QUBIT_HEADROOM_SATURATION)
}

fn status_factor(backend: &BackendInfo) -> f64 {
    if backend.status == "online" {
        1.0
    } else {
        0.0
    }
}

/// Computes an explainable, weighted score for a single backend against a
/// parsed circuit. Higher is better. Pure — no notion of which backends were
/// filtered; callers typically score only backends that already passed
/// `filter_compatible`.
pub fn score_backend(snapshot: &CircuitSnapshot, backend: &BackendInfo) -> BackendScore {
    let raw: [(&str, f64, f64); 4] = [
        ("queue", queue_factor(backend.queue_length), QUEUE_WEIGHT),
        (
            "errorRate",
            error_rate_factor(backend.average_error_rate),
            ERROR_RATE_WEIGHT,
        ),
        (
            "qubitHeadroom",
            qubit_headroom_factor(snapshot, backend),
            QUBIT_HEADROOM_WEIGHT,
        ),
        ("status", status_factor(backend), STATUS_WEIGHT),
    ];

    let factors: Vec<ScoreFactor> = raw
        .iter()
        .map(|(name, value, weight)| ScoreFactor {
            name: (*name).to_string(),
            value: *value,
            weight: *weight,
            contribution: round4(value * weight),
        })
        .collect();

    let score = round4(factors.iter().map(|f| f.contribution).sum());

    BackendScore { score, factors }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HardwarePlanCandidate {
    pub backend: BackendInfo,
    pub score: f64,
    pub factors: Vec<ScoreFactor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HardwarePlanRejected {
    pub backend: BackendInfo,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HardwarePlan {
    pub candidates: Vec<HardwarePlanCandidate>,
    pub rejected: Vec<HardwarePlanRejected>,
    pub selected: Option<BackendInfo>,
    pub rationale: String,
}

fn no_candidate_rationale(backends: &[BackendInfo], rejected: &[HardwarePlanRejected]) -> String {
    if backends.is_empty() {
        return "No hardware backends are currently known, so no recommendation can be made."
            .to_string();
    }
    let detail = rejected
        .iter()
        .map(|r| format!("{} ({})", r.backend.name, r.reasons.join("; ")))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "None of the {} known backend(s) are compatible with this circuit: {detail}.",
        backends.len()
    )
}

fn top_pick_rationale(
    top: &HardwarePlanCandidate,
    runner_up: Option<&HardwarePlanCandidate>,
) -> String {
    let summary = format!(
        "{} was selected with a score of {} (queue length {}, average error rate {}, {} qubits available).",
        top.backend.name, top.score, top.backend.queue_length, top.backend.average_error_rate, top.backend.qubit_count
    );

    match runner_up {
        None => format!("{summary} It was the only compatible backend available."),
        Some(runner_up) => format!(
            "{summary} It was preferred over the next-best candidate, {} (score {}), based on a better combination of queue length, error rate, and qubit headroom.",
            runner_up.backend.name, runner_up.score
        ),
    }
}

/// Filters backends for compatibility, scores the survivors, and picks the
/// top-scoring one as a shadow-mode recommendation. Pure and deterministic —
/// this never submits anything; it only reasons about the inputs it was
/// given.
pub fn plan_hardware_run(snapshot: &CircuitSnapshot, backends: &[BackendInfo]) -> HardwarePlan {
    let filtered = filter_compatible(snapshot, backends);
    let rejected: Vec<HardwarePlanRejected> = filtered
        .iter()
        .filter(|f| !f.compatible)
        .map(|f| HardwarePlanRejected {
            backend: f.backend.clone(),
            reasons: f.reasons.clone(),
        })
        .collect();

    let mut candidates: Vec<HardwarePlanCandidate> = filtered
        .iter()
        .filter(|f| f.compatible)
        .map(|f| {
            let BackendScore { score, factors } = score_backend(snapshot, &f.backend);
            HardwarePlanCandidate {
                backend: f.backend.clone(),
                score,
                factors,
            }
        })
        .collect();
    candidates.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));

    if candidates.is_empty() {
        let rationale = no_candidate_rationale(backends, &rejected);
        return HardwarePlan {
            candidates,
            rejected,
            selected: None,
            rationale,
        };
    }

    let top = candidates[0].clone();
    let rationale = top_pick_rationale(&top, candidates.get(1));
    let selected = Some(top.backend.clone());

    HardwarePlan {
        candidates,
        rejected,
        selected,
        rationale,
    }
}

#[cfg(test)]
mod tests;
