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

fn correct_bell() -> CircuitSnapshot {
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

fn correct_ghz_3() -> CircuitSnapshot {
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

fn correct_uniform_2() -> CircuitSnapshot {
    CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 2,
        classical_bit_count: 2,
        depth: 2,
        gates: vec![
            gate("H", vec![0], vec![]),
            gate("H", vec![1], vec![]),
            gate("measure", vec![0, 1], vec![]),
        ],
    }
}

/// Intentionally broken: a "Bell" circuit missing the entangling CNOT —
/// the H-only fragment leaves the qubits in a product state, not an
/// entangled Bell pair. Must NOT be misclassified as bell.
fn broken_bell_missing_cnot() -> CircuitSnapshot {
    CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 2,
        classical_bit_count: 2,
        depth: 2,
        gates: vec![
            gate("H", vec![0], vec![]),
            gate("measure", vec![0], vec![]),
            gate("measure", vec![1], vec![]),
        ],
    }
}

/// Intentionally broken: a "GHZ" chain that never touches qubit 2 — the
/// second CNOT re-targets qubit 1 instead of extending the chain, so the
/// circuit never entangles all 3 qubits. Must NOT be misclassified as
/// GHZ.
fn broken_ghz_disconnected() -> CircuitSnapshot {
    CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count: 3,
        classical_bit_count: 3,
        depth: 3,
        gates: vec![
            gate("H", vec![0], vec![]),
            gate("CNOT", vec![1], vec![0]),
            gate("CNOT", vec![1], vec![0]),
        ],
    }
}

#[test]
fn classifies_a_correct_bell_circuit_as_bell_with_high_confidence() {
    assert_eq!(
        classify_algorithm(&correct_bell()),
        AlgorithmClassification {
            algorithm: AlgorithmKind::Bell,
            confidence: Confidence::High
        }
    );
}

#[test]
fn classifies_a_correct_3_qubit_ghz_circuit_as_ghz_with_high_confidence() {
    assert_eq!(
        classify_algorithm(&correct_ghz_3()),
        AlgorithmClassification {
            algorithm: AlgorithmKind::Ghz,
            confidence: Confidence::High
        }
    );
}

#[test]
fn classifies_a_correct_2_qubit_uniform_superposition_with_high_confidence() {
    assert_eq!(
        classify_algorithm(&correct_uniform_2()),
        AlgorithmClassification {
            algorithm: AlgorithmKind::UniformSuperposition,
            confidence: Confidence::High
        }
    );
}

#[test]
fn does_not_misclassify_a_bell_circuit_missing_its_cnot_as_bell() {
    let result = classify_algorithm(&broken_bell_missing_cnot());
    assert_ne!(result.algorithm, AlgorithmKind::Bell);
    assert_eq!(
        result,
        AlgorithmClassification {
            algorithm: AlgorithmKind::Unknown,
            confidence: Confidence::Low
        }
    );
}

#[test]
fn does_not_misclassify_a_disconnected_ghz_attempt_as_ghz() {
    let result = classify_algorithm(&broken_ghz_disconnected());
    assert_ne!(result.algorithm, AlgorithmKind::Ghz);
    assert_eq!(
        result,
        AlgorithmClassification {
            algorithm: AlgorithmKind::Unknown,
            confidence: Confidence::Low
        }
    );
}

#[test]
fn never_returns_high_confidence_for_teleportation() {
    let teleport = CircuitSnapshot {
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
    };
    let result = classify_algorithm(&teleport);
    assert_ne!(result.confidence, Confidence::High);
}

#[test]
fn matches_the_bell_reference_distribution() {
    assert_eq!(
        expected_distribution(AlgorithmKind::Bell, 2),
        Some(HashMap::from([
            ("00".to_string(), 0.5),
            ("11".to_string(), 0.5)
        ]))
    );
}

#[test]
fn matches_the_3_qubit_ghz_reference_distribution() {
    assert_eq!(
        expected_distribution(AlgorithmKind::Ghz, 3),
        Some(HashMap::from([
            ("000".to_string(), 0.5),
            ("111".to_string(), 0.5)
        ]))
    );
}

#[test]
fn matches_the_2_qubit_uniform_superposition_reference_distribution() {
    assert_eq!(
        expected_distribution(AlgorithmKind::UniformSuperposition, 2),
        Some(HashMap::from([
            ("00".to_string(), 0.25),
            ("01".to_string(), 0.25),
            ("10".to_string(), 0.25),
            ("11".to_string(), 0.25),
        ]))
    );
}

#[test]
fn returns_none_for_teleportation_outcome_depends_on_the_input_state() {
    assert_eq!(expected_distribution(AlgorithmKind::Teleportation, 3), None);
}

#[test]
fn returns_none_for_unknown() {
    assert_eq!(expected_distribution(AlgorithmKind::Unknown, 2), None);
}
