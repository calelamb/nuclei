use super::super::Gate;
use super::*;

fn bell_gates() -> Vec<Gate> {
    vec![
        Gate {
            gate_type: "H".to_string(),
            targets: vec![0],
            controls: vec![],
            params: vec![],
            layer: 0,
        },
        Gate {
            gate_type: "CNOT".to_string(),
            targets: vec![1],
            controls: vec![0],
            params: vec![],
            layer: 1,
        },
        Gate {
            gate_type: "measure".to_string(),
            targets: vec![0],
            controls: vec![],
            params: vec![],
            layer: 2,
        },
        Gate {
            gate_type: "measure".to_string(),
            targets: vec![1],
            controls: vec![],
            params: vec![],
            layer: 2,
        },
    ]
}

fn make_snapshot(qubit_count: u32, gates: Vec<Gate>) -> CircuitSnapshot {
    CircuitSnapshot {
        framework: "qiskit".to_string(),
        qubit_count,
        classical_bit_count: 3,
        depth: 3,
        gates,
    }
}

fn make_backend(
    name: &str,
    qubit_count: u32,
    queue_length: u32,
    average_error_rate: f64,
    gate_set: Vec<&str>,
    status: &str,
) -> BackendInfo {
    BackendInfo {
        name: name.to_string(),
        provider: "ibm".to_string(),
        qubit_count,
        connectivity: Vec::new(),
        queue_length,
        average_error_rate,
        gate_set: gate_set.into_iter().map(|s| s.to_string()).collect(),
        status: status.to_string(),
    }
}

#[test]
fn rejects_a_backend_with_too_few_qubits() {
    let snapshot = make_snapshot(3, bell_gates());
    let backend = make_backend("small", 2, 5, 0.01, vec!["h", "cx", "measure"], "online");
    let result = &filter_compatible(&snapshot, &[backend])[0];
    assert!(!result.compatible);
    assert!(result
        .reasons
        .iter()
        .any(|r| r.contains("needs 3 qubits, backend has 2")));
}

#[test]
fn accepts_an_online_backend_with_enough_qubits_and_gate_coverage() {
    let snapshot = make_snapshot(3, bell_gates());
    let backend = make_backend("ok", 5, 5, 0.01, vec!["h", "cx", "measure"], "online");
    let result = &filter_compatible(&snapshot, &[backend])[0];
    assert!(result.compatible);
    assert!(result.reasons.is_empty());
}

#[test]
fn rejects_a_backend_missing_a_used_gate_in_its_advertised_gate_set() {
    let gates = vec![Gate {
        gate_type: "TOFFOLI".to_string(),
        targets: vec![2],
        controls: vec![0, 1],
        params: vec![],
        layer: 0,
    }];
    let snapshot = make_snapshot(3, gates);
    let backend = make_backend("test", 5, 5, 0.01, vec!["h", "cx", "measure"], "online");
    let result = &filter_compatible(&snapshot, &[backend])[0];
    assert!(!result.compatible);
    assert!(result.reasons.iter().any(|r| r.contains("TOFFOLI")));
}

#[test]
fn does_not_reject_a_cnot_cx_synonym_pair() {
    let gates = vec![Gate {
        gate_type: "CNOT".to_string(),
        targets: vec![1],
        controls: vec![0],
        params: vec![],
        layer: 0,
    }];
    let snapshot = make_snapshot(2, gates);
    let backend = make_backend("test", 2, 5, 0.01, vec!["h", "cx", "measure"], "online");
    let result = &filter_compatible(&snapshot, &[backend])[0];
    assert!(result.compatible);
}

#[test]
fn rejects_an_offline_backend_with_a_status_reason() {
    let snapshot = make_snapshot(3, bell_gates());
    let backend = make_backend(
        "test",
        5,
        5,
        0.01,
        vec!["h", "cx", "measure"],
        "maintenance",
    );
    let result = &filter_compatible(&snapshot, &[backend])[0];
    assert!(!result.compatible);
    assert!(result.reasons.iter().any(|r| r.contains("maintenance")));
}

#[test]
fn never_rejects_on_gate_coverage_when_gate_set_is_empty_or_unknown() {
    let gates = vec![Gate {
        gate_type: "TOFFOLI".to_string(),
        targets: vec![2],
        controls: vec![0, 1],
        params: vec![],
        layer: 0,
    }];
    let snapshot = make_snapshot(3, gates);
    let backend = make_backend("test", 5, 5, 0.01, vec![], "online");
    let result = &filter_compatible(&snapshot, &[backend])[0];
    assert!(result.compatible);
}

#[test]
fn scores_a_backend_with_a_lower_queue_and_error_rate_higher_than_a_busier_noisier_one() {
    let snapshot = make_snapshot(2, bell_gates());
    let good = make_backend("good", 5, 1, 0.001, vec!["h", "cx", "measure"], "online");
    let bad = make_backend("bad", 5, 50, 0.1, vec!["h", "cx", "measure"], "online");

    let good_score = score_backend(&snapshot, &good).score;
    let bad_score = score_backend(&snapshot, &bad).score;

    assert!(good_score > bad_score);
}

#[test]
fn returns_explainable_factors_summing_to_the_reported_score() {
    let snapshot = make_snapshot(2, bell_gates());
    let backend = make_backend("test", 5, 5, 0.01, vec!["h", "cx", "measure"], "online");
    let BackendScore { score, factors } = score_backend(&snapshot, &backend);

    assert!(!factors.is_empty());
    for factor in &factors {
        assert!(factor.value >= 0.0);
        assert!(factor.value <= 1.0);
        assert!((factor.contribution - factor.value * factor.weight).abs() < 1e-4);
    }
    let total: f64 = factors.iter().map(|f| f.contribution).sum();
    assert!((score - total).abs() < 1e-4);
}

#[test]
fn selects_the_best_scoring_compatible_backend_and_gives_a_non_empty_rationale() {
    let snapshot = make_snapshot(2, bell_gates());
    let busy = make_backend("busy", 5, 80, 0.05, vec!["h", "cx", "measure"], "online");
    let great = make_backend("great", 5, 0, 0.001, vec!["h", "cx", "measure"], "online");
    let too_small = make_backend("tiny", 1, 5, 0.01, vec!["h", "cx", "measure"], "online");

    let plan = plan_hardware_run(&snapshot, &[busy, great, too_small]);

    assert_eq!(
        plan.selected.as_ref().map(|b| b.name.as_str()),
        Some("great")
    );
    assert_eq!(plan.candidates.len(), 2);
    assert_eq!(plan.rejected.len(), 1);
    assert_eq!(plan.rejected[0].backend.name, "tiny");
    assert!(!plan.rationale.is_empty());
    assert!(plan.rationale.contains("great"));
}

#[test]
fn returns_a_null_selection_with_a_rationale_when_no_backends_are_given() {
    let snapshot = make_snapshot(3, bell_gates());
    let plan = plan_hardware_run(&snapshot, &[]);
    assert!(plan.selected.is_none());
    assert!(plan.candidates.is_empty());
    assert!(plan.rejected.is_empty());
    assert!(!plan.rationale.is_empty());
}

#[test]
fn returns_a_null_selection_with_a_rationale_when_nothing_is_compatible() {
    let snapshot = make_snapshot(10, bell_gates());
    let backend = make_backend("test", 2, 5, 0.01, vec!["h", "cx", "measure"], "online");
    let plan = plan_hardware_run(&snapshot, &[backend]);
    assert!(plan.selected.is_none());
    assert_eq!(plan.rejected.len(), 1);
    assert!(!plan.rationale.is_empty());
}
