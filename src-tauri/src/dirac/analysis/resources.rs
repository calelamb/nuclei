//! Resource estimation over a parsed circuit (port of `estimateResources` in
//! `src/services/agent/analysis.ts`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::{involved_qubit_count, is_measurement_type, CircuitSnapshot};

/// T and T-dagger, in every spelling this codebase's adapters/tests use.
const T_GATE_TYPES: &[&str] = &["T", "TDG", "T†", "TDAGGER"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResourceEstimate {
    pub qubit_count: u32,
    pub classical_bit_count: u32,
    pub depth: u32,
    pub gate_count: usize,
    pub two_qubit_gate_count: usize,
    pub multi_qubit_gate_count: usize,
    pub measurement_count: usize,
    pub gate_histogram: HashMap<String, usize>,
    /// Count of T / T-dagger gates — the standard proxy for non-Clifford
    /// ("magic state") cost in fault-tolerant resource estimation.
    pub t_count: usize,
    /// Count of gates acting on exactly one qubit.
    pub single_qubit_gate_count: usize,
    /// Count of gates that are not measurements.
    pub non_measurement_gate_count: usize,
}

/// Computes qubit/gate/depth resource metrics for a parsed circuit. Pure —
/// takes a snapshot, returns a plain summary, no side effects.
pub fn estimate_resources(snapshot: &CircuitSnapshot) -> ResourceEstimate {
    let mut gate_histogram: HashMap<String, usize> = HashMap::new();
    let mut two_qubit_gate_count = 0;
    let mut multi_qubit_gate_count = 0;
    let mut measurement_count = 0;
    let mut t_count = 0;
    let mut single_qubit_gate_count = 0;
    let mut non_measurement_gate_count = 0;

    for gate in &snapshot.gates {
        let key = gate.gate_type.to_uppercase();
        *gate_histogram.entry(key.clone()).or_insert(0) += 1;

        let involved = involved_qubit_count(gate);
        if involved == 2 {
            two_qubit_gate_count += 1;
        }
        if involved >= 2 {
            multi_qubit_gate_count += 1;
        }
        if involved == 1 {
            single_qubit_gate_count += 1;
        }
        if T_GATE_TYPES.contains(&key.as_str()) {
            t_count += 1;
        }

        if is_measurement_type(&gate.gate_type) {
            measurement_count += 1;
        } else {
            non_measurement_gate_count += 1;
        }
    }

    ResourceEstimate {
        qubit_count: snapshot.qubit_count,
        classical_bit_count: snapshot.classical_bit_count,
        depth: snapshot.depth,
        gate_count: snapshot.gates.len(),
        two_qubit_gate_count,
        multi_qubit_gate_count,
        measurement_count,
        gate_histogram,
        t_count,
        single_qubit_gate_count,
        non_measurement_gate_count,
    }
}

#[cfg(test)]
mod tests {
    use super::super::{CircuitSnapshot, Gate};
    use super::*;

    fn gate(gate_type: &str, targets: Vec<i64>, controls: Vec<i64>) -> Gate {
        Gate {
            gate_type: gate_type.to_string(),
            targets,
            controls,
            params: Vec::new(),
            layer: 0,
        }
    }

    fn bell_snapshot() -> CircuitSnapshot {
        CircuitSnapshot {
            framework: "qiskit".to_string(),
            qubit_count: 2,
            classical_bit_count: 2,
            depth: 3,
            gates: vec![
                gate("H", vec![0], vec![]),
                gate("CNOT", vec![1], vec![0]),
                gate("measure", vec![0], vec![]),
                gate("measure", vec![1], vec![]),
            ],
        }
    }

    fn ghz_snapshot() -> CircuitSnapshot {
        CircuitSnapshot {
            framework: "qiskit".to_string(),
            qubit_count: 3,
            classical_bit_count: 3,
            depth: 4,
            gates: vec![
                gate("H", vec![0], vec![]),
                gate("CNOT", vec![1], vec![0]),
                gate("CNOT", vec![2], vec![1]),
                gate("measure", vec![0, 1, 2], vec![]),
            ],
        }
    }

    #[test]
    fn summarizes_a_bell_circuit() {
        let estimate = estimate_resources(&bell_snapshot());
        assert_eq!(estimate.qubit_count, 2);
        assert_eq!(estimate.classical_bit_count, 2);
        assert_eq!(estimate.depth, 3);
        assert_eq!(estimate.gate_count, 4);
        assert_eq!(estimate.two_qubit_gate_count, 1);
        assert_eq!(estimate.multi_qubit_gate_count, 1);
        assert_eq!(estimate.measurement_count, 2);
        assert_eq!(
            estimate.gate_histogram,
            HashMap::from([
                ("H".to_string(), 1),
                ("CNOT".to_string(), 1),
                ("MEASURE".to_string(), 2)
            ])
        );
        assert_eq!(estimate.t_count, 0);
        // H(0) plus the two single-qubit measure gates are each single-qubit.
        assert_eq!(estimate.single_qubit_gate_count, 3);
        assert_eq!(estimate.non_measurement_gate_count, 2);
    }

    #[test]
    fn summarizes_a_ghz_circuit() {
        let estimate = estimate_resources(&ghz_snapshot());
        assert_eq!(estimate.qubit_count, 3);
        assert_eq!(estimate.gate_count, 4);
        assert_eq!(estimate.two_qubit_gate_count, 2);
        assert_eq!(estimate.measurement_count, 1);
        assert_eq!(
            estimate.gate_histogram,
            HashMap::from([
                ("H".to_string(), 1),
                ("CNOT".to_string(), 2),
                ("MEASURE".to_string(), 1)
            ])
        );
        assert_eq!(estimate.t_count, 0);
        assert_eq!(estimate.single_qubit_gate_count, 1);
        assert_eq!(estimate.non_measurement_gate_count, 3);
    }

    #[test]
    fn counts_t_and_t_dagger_gates_as_t_count_regardless_of_spelling() {
        let snapshot = CircuitSnapshot {
            framework: "qiskit".to_string(),
            qubit_count: 1,
            classical_bit_count: 0,
            depth: 5,
            gates: vec![
                gate("T", vec![0], vec![]),
                gate("tdg", vec![0], vec![]),
                gate("T†", vec![0], vec![]),
                gate("TDAGGER", vec![0], vec![]),
                gate("H", vec![0], vec![]),
            ],
        };
        let estimate = estimate_resources(&snapshot);
        assert_eq!(estimate.t_count, 4);
        assert_eq!(estimate.single_qubit_gate_count, 5);
        assert_eq!(estimate.non_measurement_gate_count, 5);
    }

    #[test]
    fn uppercases_gate_types_in_the_histogram_regardless_of_source_casing() {
        let snapshot = CircuitSnapshot {
            framework: "cirq".to_string(),
            qubit_count: 1,
            classical_bit_count: 0,
            depth: 1,
            gates: vec![gate("h", vec![0], vec![])],
        };
        assert_eq!(
            estimate_resources(&snapshot).gate_histogram,
            HashMap::from([("H".to_string(), 1)])
        );
    }

    #[test]
    fn returns_zeroed_metrics_for_an_empty_circuit() {
        let snapshot = CircuitSnapshot {
            framework: "qiskit".to_string(),
            qubit_count: 1,
            classical_bit_count: 0,
            depth: 0,
            gates: Vec::new(),
        };
        let estimate = estimate_resources(&snapshot);
        assert_eq!(estimate.gate_count, 0);
        assert_eq!(estimate.two_qubit_gate_count, 0);
        assert_eq!(estimate.measurement_count, 0);
        assert!(estimate.gate_histogram.is_empty());
        assert_eq!(estimate.t_count, 0);
        assert_eq!(estimate.single_qubit_gate_count, 0);
        assert_eq!(estimate.non_measurement_gate_count, 0);
    }
}
