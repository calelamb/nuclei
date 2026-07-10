//! Conservative, pure classification of a parsed circuit as one of a small
//! set of canonical teaching algorithms, plus the known-correct reference
//! distribution for the ones whose outcome doesn't depend on an input state
//! (port of `src/services/agent/algorithms.ts`).
//!
//! Every check here is deliberately strict: a circuit is only ever labeled
//! with [`Confidence::High`] when its gate structure is an unambiguous match
//! for the textbook construction. Anything else falls through to
//! [`AlgorithmKind::Unknown`] (or, for the one genuinely input-dependent
//! case, [`Confidence::Low`]) rather than guessing.

use std::collections::HashMap;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::{is_measurement_type, CircuitSnapshot, Gate};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlgorithmKind {
    Bell,
    Ghz,
    UniformSuperposition,
    Teleportation,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Low,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlgorithmClassification {
    pub algorithm: AlgorithmKind,
    pub confidence: Confidence,
}

fn is_single_qubit_h(gate: &Gate) -> bool {
    gate.gate_type.to_uppercase() == "H" && gate.controls.is_empty() && gate.targets.len() == 1
}

fn is_cnot(gate: &Gate) -> bool {
    matches!(gate.gate_type.to_uppercase().as_str(), "CNOT" | "CX")
        && gate.controls.len() == 1
        && gate.targets.len() == 1
}

fn core_gates(snapshot: &CircuitSnapshot) -> Vec<&Gate> {
    snapshot
        .gates
        .iter()
        .filter(|g| !is_measurement_type(&g.gate_type))
        .collect()
}

/// Bell: exactly 2 qubits, exactly one H followed by exactly one CNOT/CX
/// whose control is the qubit H acted on and whose target is the other
/// qubit. Any other core gate present disqualifies the match.
fn classify_bell(snapshot: &CircuitSnapshot) -> bool {
    if snapshot.qubit_count != 2 {
        return false;
    }
    let core = core_gates(snapshot);
    if core.len() != 2 {
        return false;
    }

    let (h, cx) = (core[0], core[1]);
    if !is_single_qubit_h(h) || !is_cnot(cx) {
        return false;
    }

    let h_qubit = h.targets[0];
    let control = cx.controls[0];
    let target = cx.targets[0];
    control == h_qubit && target != h_qubit
}

/// GHZ: n >= 3 qubits, exactly one H followed by exactly n-1 CNOT/CX gates
/// that entangle every remaining qubit into the set the H qubit started —
/// accepts both the chain (0->1->2->...) and star (0->1, 0->2, ...) forms,
/// rejecting anything that doesn't fully connect all n qubits.
fn classify_ghz(snapshot: &CircuitSnapshot) -> bool {
    let n = snapshot.qubit_count;
    if n < 3 {
        return false;
    }

    let core = core_gates(snapshot);
    if core.len() as u32 != n {
        return false;
    }

    let (first, rest) = (core[0], &core[1..]);
    if !is_single_qubit_h(first) {
        return false;
    }
    if !rest.iter().all(|g| is_cnot(g)) {
        return false;
    }

    let mut entangled: HashSet<i64> = HashSet::new();
    entangled.insert(first.targets[0]);
    for gate in rest {
        let control = gate.controls[0];
        let target = gate.targets[0];
        if !entangled.contains(&control) || entangled.contains(&target) {
            return false;
        }
        entangled.insert(target);
    }

    entangled.len() as u32 == n
}

/// Uniform superposition: n qubits, exactly one H per qubit (every qubit
/// targeted exactly once), and no entangling (2+ qubit) gates at all.
fn classify_uniform_superposition(snapshot: &CircuitSnapshot) -> bool {
    let n = snapshot.qubit_count;
    if n < 1 {
        return false;
    }

    let core = core_gates(snapshot);
    if core.len() as u32 != n {
        return false;
    }
    if !core.iter().all(|g| is_single_qubit_h(g)) {
        return false;
    }

    let targeted: HashSet<i64> = core.iter().map(|g| g.targets[0]).collect();
    if targeted.len() as u32 != n {
        return false;
    }
    (0..i64::from(n)).all(|q| targeted.contains(&q))
}

/// Conservative teleportation heuristic: 3 qubits, at least 2 classical
/// bits, at least 2 H gates, at least 2 CNOT/CX gates, and at least 2
/// distinct qubits measured. Confidence is therefore capped at `Low` — this
/// never claims `High` for teleportation.
fn looks_like_teleportation(snapshot: &CircuitSnapshot) -> bool {
    if snapshot.qubit_count != 3 || snapshot.classical_bit_count < 2 {
        return false;
    }

    let core = core_gates(snapshot);
    let h_count = core.iter().filter(|g| is_single_qubit_h(g)).count();
    let cnot_count = core.iter().filter(|g| is_cnot(g)).count();

    let mut measured_qubits: HashSet<i64> = HashSet::new();
    for gate in &snapshot.gates {
        if is_measurement_type(&gate.gate_type) {
            measured_qubits.extend(gate.targets.iter().copied());
        }
    }

    h_count >= 2 && cnot_count >= 2 && measured_qubits.len() >= 2
}

/// Classifies a parsed circuit as one of the recognized canonical teaching
/// algorithms. Pure and conservative: `High` confidence is only ever
/// returned for an unambiguous structural match; everything else is `Low`
/// (including a plausible-but-unverifiable teleportation guess) so callers
/// never treat a shaky guess as a verified fact.
pub fn classify_algorithm(snapshot: &CircuitSnapshot) -> AlgorithmClassification {
    if classify_bell(snapshot) {
        return AlgorithmClassification {
            algorithm: AlgorithmKind::Bell,
            confidence: Confidence::High,
        };
    }
    if classify_ghz(snapshot) {
        return AlgorithmClassification {
            algorithm: AlgorithmKind::Ghz,
            confidence: Confidence::High,
        };
    }
    if classify_uniform_superposition(snapshot) {
        return AlgorithmClassification {
            algorithm: AlgorithmKind::UniformSuperposition,
            confidence: Confidence::High,
        };
    }
    if looks_like_teleportation(snapshot) {
        return AlgorithmClassification {
            algorithm: AlgorithmKind::Teleportation,
            confidence: Confidence::Low,
        };
    }
    AlgorithmClassification {
        algorithm: AlgorithmKind::Unknown,
        confidence: Confidence::Low,
    }
}

/// Above this many qubits, a uniform-superposition reference distribution
/// would need 2^n entries — capped to avoid building huge maps for a
/// classification that Dirac wouldn't usefully iterate over anyway.
const UNIFORM_SUPERPOSITION_QUBIT_CAP: u32 = 10;

/// Known-correct reference distribution for a classified algorithm, or
/// `None` when the outcome legitimately depends on the input state
/// (teleportation) or the circuit wasn't recognized as one of the
/// fixed-outcome algorithms.
///
/// Bitstring keys follow the same convention the kernel adapters use to key
/// `SimulationResult.probabilities`: zero-padded binary of the state-vector
/// index, qubit 0 as the leftmost (most-significant) character.
pub fn expected_distribution(
    algorithm: AlgorithmKind,
    qubit_count: u32,
) -> Option<HashMap<String, f64>> {
    match algorithm {
        AlgorithmKind::Bell => {
            if qubit_count == 2 {
                Some(HashMap::from([
                    ("00".to_string(), 0.5),
                    ("11".to_string(), 0.5),
                ]))
            } else {
                None
            }
        }
        AlgorithmKind::Ghz => {
            if qubit_count < 3 {
                return None;
            }
            let zeros = "0".repeat(qubit_count as usize);
            let ones = "1".repeat(qubit_count as usize);
            Some(HashMap::from([(zeros, 0.5), (ones, 0.5)]))
        }
        AlgorithmKind::UniformSuperposition => {
            if !(1..=UNIFORM_SUPERPOSITION_QUBIT_CAP).contains(&qubit_count) {
                return None;
            }
            let total = 1u32 << qubit_count;
            let probability = 1.0 / f64::from(total);
            let mut distribution = HashMap::new();
            for i in 0..total {
                distribution.insert(
                    format!("{:0width$b}", i, width = qubit_count as usize),
                    probability,
                );
            }
            Some(distribution)
        }
        AlgorithmKind::Teleportation | AlgorithmKind::Unknown => None,
    }
}

#[cfg(test)]
mod tests;
