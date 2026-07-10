//! Curated, no-false-positive structural/semantic validators plus
//! distribution comparison (port of `validateProgram`/`compareDistributions`
//! in `src/services/agent/analysis.ts`).

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::{involved_qubit_count, is_measurement_type, CircuitSnapshot};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
}

/// Expected involved-qubit count for canonical gates whose arity is
/// unambiguous. Types not listed here are intentionally left unchecked —
/// custom or parametrized-arity gates (e.g. RZZ) must never produce a false
/// positive.
fn known_arity(gate_type: &str) -> Option<u32> {
    match gate_type.to_uppercase().as_str() {
        "H" | "X" | "Y" | "Z" | "S" | "T" | "SX" | "RX" | "RY" | "RZ" | "PHASE" | "P" | "U1" => {
            Some(1)
        }
        "CNOT" | "CX" | "CZ" | "SWAP" | "CY" | "CH" => Some(2),
        "CCX" | "TOFFOLI" | "CSWAP" | "FREDKIN" => Some(3),
        _ => None,
    }
}

fn check_empty_circuit(snapshot: &CircuitSnapshot) -> Vec<Diagnostic> {
    if !snapshot.gates.is_empty() {
        return Vec::new();
    }
    vec![Diagnostic {
        severity: DiagnosticSeverity::Warning,
        code: "empty_circuit".to_string(),
        message: "The circuit has no gates.".to_string(),
    }]
}

fn check_no_measurement(snapshot: &CircuitSnapshot) -> Vec<Diagnostic> {
    let has_measurement = snapshot
        .gates
        .iter()
        .any(|g| is_measurement_type(&g.gate_type));
    if has_measurement || snapshot.classical_bit_count != 0 {
        return Vec::new();
    }
    vec![Diagnostic {
        severity: DiagnosticSeverity::Info,
        code: "no_measurement".to_string(),
        message: "No measurement gates and no classical bits — this program is statevector-only; add measurements to see counts.".to_string(),
    }]
}

fn check_qubit_range(snapshot: &CircuitSnapshot) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for gate in &snapshot.gates {
        for &index in gate.targets.iter().chain(gate.controls.iter()) {
            if index < 0 || index >= i64::from(snapshot.qubit_count) {
                diagnostics.push(Diagnostic {
                    severity: DiagnosticSeverity::Error,
                    code: "qubit_out_of_range".to_string(),
                    message: format!(
                        "Gate {} references qubit index {}, which is out of range for a {}-qubit circuit.",
                        gate.gate_type, index, snapshot.qubit_count
                    ),
                });
            }
        }
    }
    diagnostics
}

fn check_control_equals_target(snapshot: &CircuitSnapshot) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for gate in &snapshot.gates {
        let controls: HashSet<i64> = gate.controls.iter().copied().collect();
        for &target in &gate.targets {
            if controls.contains(&target) {
                diagnostics.push(Diagnostic {
                    severity: DiagnosticSeverity::Error,
                    code: "control_equals_target".to_string(),
                    message: format!(
                        "Gate {} uses qubit {target} as both a control and a target.",
                        gate.gate_type
                    ),
                });
            }
        }
    }
    diagnostics
}

fn check_arity_mismatch(snapshot: &CircuitSnapshot) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for gate in &snapshot.gates {
        let Some(expected) = known_arity(&gate.gate_type) else {
            continue;
        };
        let involved = involved_qubit_count(gate) as u32;
        if involved != expected {
            diagnostics.push(Diagnostic {
                severity: DiagnosticSeverity::Warning,
                code: "arity_mismatch".to_string(),
                message: format!(
                    "Gate {} expects {expected} qubit(s) but involves {involved}.",
                    gate.gate_type
                ),
            });
        }
    }
    diagnostics
}

/// Runs a curated, no-false-positive set of structural/semantic checks over
/// a parsed circuit. Every check is deliberately conservative: types or
/// shapes it doesn't recognize are left alone rather than flagged.
pub fn validate_program(snapshot: &CircuitSnapshot) -> Vec<Diagnostic> {
    let mut diagnostics = check_empty_circuit(snapshot);
    diagnostics.extend(check_no_measurement(snapshot));
    diagnostics.extend(check_qubit_range(snapshot));
    diagnostics.extend(check_control_equals_target(snapshot));
    diagnostics.extend(check_arity_mismatch(snapshot));
    diagnostics
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComparisonPerState {
    pub state: String,
    pub actual: f64,
    pub expected: f64,
    pub delta: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComparisonReport {
    pub matches: bool,
    pub worst_delta: f64,
    pub total_variation_distance: f64,
    pub per_state: Vec<ComparisonPerState>,
}

/// Default comparison tolerance (mirrors the TS `DEFAULT_COMPARE_TOLERANCE`).
/// Rust has no default-parameter syntax, so callers that want the TS
/// default's behavior pass this constant explicitly.
pub const DEFAULT_COMPARE_TOLERANCE: f64 = 0.1;

/// Compares two probability distributions over measurement outcomes. Pure —
/// no reference to any live simulation; callers pass the two maps directly.
pub fn compare_distributions(
    actual: &HashMap<String, f64>,
    expected: &HashMap<String, f64>,
    tolerance: f64,
) -> ComparisonReport {
    let mut states: Vec<String> = actual.keys().chain(expected.keys()).cloned().collect();
    states.sort();
    states.dedup();

    let mut per_state: Vec<ComparisonPerState> = states
        .into_iter()
        .map(|state| {
            let actual_value = actual.get(&state).copied().unwrap_or(0.0);
            let expected_value = expected.get(&state).copied().unwrap_or(0.0);
            let delta = (actual_value - expected_value).abs();
            ComparisonPerState {
                state,
                actual: actual_value,
                expected: expected_value,
                delta,
            }
        })
        .collect();

    per_state.sort_by(|a, b| b.delta.partial_cmp(&a.delta).unwrap_or(Ordering::Equal));

    let worst_delta = per_state
        .iter()
        .fold(0.0_f64, |max, entry| max.max(entry.delta));
    let total_variation_distance = 0.5 * per_state.iter().map(|e| e.delta).sum::<f64>();
    let matches = worst_delta <= tolerance;

    ComparisonReport {
        matches,
        worst_delta,
        total_variation_distance,
        per_state,
    }
}

#[cfg(test)]
mod tests;
