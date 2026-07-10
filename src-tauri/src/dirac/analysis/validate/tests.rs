use super::super::Gate;
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

fn teleport_snapshot() -> CircuitSnapshot {
    CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 3,
        classical_bit_count: 3,
        depth: 6,
        gates: vec![
            gate("H", vec![1], vec![]),
            gate("CNOT", vec![2], vec![1]),
            gate("CNOT", vec![1], vec![0]),
            gate("H", vec![0], vec![]),
            gate("measure", vec![0, 1], vec![]),
            gate("CCX", vec![2], vec![0, 1]),
        ],
    }
}

#[test]
fn produces_zero_diagnostics_for_a_correct_bell_circuit() {
    assert!(validate_program(&bell_snapshot()).is_empty());
}

#[test]
fn produces_zero_diagnostics_for_a_correct_ghz_circuit() {
    assert!(validate_program(&ghz_snapshot()).is_empty());
}

#[test]
fn produces_zero_diagnostics_for_a_correct_teleportation_circuit() {
    assert!(validate_program(&teleport_snapshot()).is_empty());
}

#[test]
fn flags_an_empty_circuit_as_a_warning() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 1,
        classical_bit_count: 0,
        depth: 0,
        gates: Vec::new(),
    };
    let diagnostics = validate_program(&snapshot);
    assert!(diagnostics
        .iter()
        .any(|d| d.severity == DiagnosticSeverity::Warning && d.code == "empty_circuit"));
}

#[test]
fn flags_only_empty_circuit_when_classical_bits_exist_but_the_circuit_is_empty() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 1,
        classical_bit_count: 1,
        depth: 0,
        gates: Vec::new(),
    };
    let diagnostics = validate_program(&snapshot);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "empty_circuit");
}

#[test]
fn flags_an_out_of_range_qubit_index_as_an_error() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 2,
        classical_bit_count: 0,
        depth: 1,
        gates: vec![gate("X", vec![5], vec![])],
    };
    let diagnostics = validate_program(&snapshot);
    assert!(diagnostics
        .iter()
        .any(|d| d.severity == DiagnosticSeverity::Error && d.code == "qubit_out_of_range"));
}

#[test]
fn flags_a_negative_qubit_index_as_an_error() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 2,
        classical_bit_count: 0,
        depth: 1,
        gates: vec![gate("X", vec![-1], vec![])],
    };
    let diagnostics = validate_program(&snapshot);
    assert!(diagnostics
        .iter()
        .any(|d| d.severity == DiagnosticSeverity::Error && d.code == "qubit_out_of_range"));
}

#[test]
fn flags_a_control_equal_to_its_target_as_an_error() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 2,
        classical_bit_count: 0,
        depth: 1,
        gates: vec![gate("CNOT", vec![0], vec![0])],
    };
    let diagnostics = validate_program(&snapshot);
    assert!(diagnostics
        .iter()
        .any(|d| d.severity == DiagnosticSeverity::Error && d.code == "control_equals_target"));
}

#[test]
fn flags_an_arity_mismatch_for_a_known_single_qubit_gate_applied_to_two_qubits() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 2,
        classical_bit_count: 0,
        depth: 1,
        gates: vec![gate("H", vec![0, 1], vec![])],
    };
    let diagnostics = validate_program(&snapshot);
    assert!(diagnostics
        .iter()
        .any(|d| d.severity == DiagnosticSeverity::Warning && d.code == "arity_mismatch"));
}

#[test]
fn does_not_flag_arity_for_gate_types_outside_the_known_arity_table() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 3,
        classical_bit_count: 0,
        depth: 1,
        gates: vec![gate("RZZ", vec![0, 1, 2], vec![])],
    };
    assert!(validate_program(&snapshot)
        .iter()
        .all(|d| d.code != "arity_mismatch"));
}

#[test]
fn flags_statevector_only_circuits_with_no_classical_bits_and_no_measurement() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 1,
        classical_bit_count: 0,
        depth: 1,
        gates: vec![gate("H", vec![0], vec![])],
    };
    let diagnostics = validate_program(&snapshot);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, "no_measurement");
}

#[test]
fn does_not_flag_no_measurement_when_classical_bits_exist_even_without_a_measure_gate() {
    let snapshot = CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 1,
        classical_bit_count: 1,
        depth: 1,
        gates: vec![gate("H", vec![0], vec![])],
    };
    assert!(validate_program(&snapshot)
        .iter()
        .all(|d| d.code != "no_measurement"));
}

#[test]
fn reports_zero_tvd_and_a_match_for_identical_distributions() {
    let actual = HashMap::from([("00".to_string(), 0.5), ("11".to_string(), 0.5)]);
    let expected = actual.clone();
    let report = compare_distributions(&actual, &expected, DEFAULT_COMPARE_TOLERANCE);
    assert_eq!(report.total_variation_distance, 0.0);
    assert_eq!(report.worst_delta, 0.0);
    assert!(report.matches);
}

#[test]
fn computes_tvd_half_and_no_match_against_a_fully_divergent_distribution() {
    let actual = HashMap::from([("00".to_string(), 0.5), ("11".to_string(), 0.5)]);
    let expected = HashMap::from([("00".to_string(), 1.0)]);
    let report = compare_distributions(&actual, &expected, DEFAULT_COMPARE_TOLERANCE);
    assert!((report.total_variation_distance - 0.5).abs() < 1e-9);
    assert!((report.worst_delta - 0.5).abs() < 1e-9);
    assert!(!report.matches);
}

#[test]
fn treats_a_missing_key_in_either_map_as_probability_zero() {
    let actual = HashMap::from([("00".to_string(), 0.3)]);
    let expected = HashMap::from([("00".to_string(), 0.3), ("11".to_string(), 0.7)]);
    let report = compare_distributions(&actual, &expected, DEFAULT_COMPARE_TOLERANCE);
    let eleven = report
        .per_state
        .iter()
        .find(|p| p.state == "11")
        .expect("state 11 should be present");
    assert_eq!(eleven.actual, 0.0);
    assert_eq!(eleven.expected, 0.7);
    assert_eq!(eleven.delta, 0.7);
}

#[test]
fn sorts_per_state_by_delta_descending() {
    let actual = HashMap::from([("00".to_string(), 0.1), ("01".to_string(), 0.9)]);
    let expected = HashMap::from([("00".to_string(), 0.5), ("01".to_string(), 0.5)]);
    let report = compare_distributions(&actual, &expected, DEFAULT_COMPARE_TOLERANCE);
    let deltas: Vec<f64> = report.per_state.iter().map(|p| p.delta).collect();
    let mut sorted = deltas.clone();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(Ordering::Equal));
    assert_eq!(deltas, sorted);
}

#[test]
fn respects_a_custom_tolerance() {
    let actual = HashMap::from([("00".to_string(), 0.52)]);
    let expected = HashMap::from([("00".to_string(), 0.5)]);
    let tight = compare_distributions(&actual, &expected, 0.01);
    assert!(!tight.matches);
    let loose = compare_distributions(&actual, &expected, 0.05);
    assert!(loose.matches);
}
