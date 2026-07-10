use super::*;

fn sim_facts() -> SubmissionFacts {
    SubmissionFacts {
        provider: "simulator".to_string(),
        backend: "local-sim".to_string(),
        shots: 1024,
        qubits: 2,
        depth: 3,
        is_simulator: true,
        estimated_cost: Some(0.0),
    }
}

fn qpu_facts() -> SubmissionFacts {
    SubmissionFacts {
        provider: "ibm".to_string(),
        backend: "ibm-brisbane".to_string(),
        shots: 1024,
        qubits: 5,
        depth: 10,
        is_simulator: false,
        estimated_cost: Some(2.0),
    }
}

fn permissive_policy() -> AutonomyPolicy {
    AutonomyPolicy {
        autonomous_hardware_enabled: true,
        allow_simulator: true,
        allow_qpu: true,
        provider_allowlist: vec!["ibm".to_string()],
        max_spend: 10.0,
        max_shots: 4096,
        max_qubits: 32,
        max_circuit_depth: 1000,
        cost_unknown_behavior: CostUnknownBehavior::NeedsApproval,
    }
}

#[test]
fn default_policy_allows_a_simulator_submission() {
    let decision =
        evaluate_submission(&sim_facts(), &AutonomyPolicy::safe_default(), f64::INFINITY);
    assert_eq!(decision.decision, Decision::Allow);
    assert!(decision.reasons.is_empty());
}

/// Safety-critical: default policy + real QPU must always come back
/// NeedsApproval, never Allow.
#[test]
fn default_policy_needs_approval_for_a_real_qpu_submission() {
    let decision =
        evaluate_submission(&qpu_facts(), &AutonomyPolicy::safe_default(), f64::INFINITY);
    assert_eq!(decision.decision, Decision::NeedsApproval);
    assert!(!decision.reasons.is_empty());
}

#[test]
fn autonomous_hardware_disabled_always_dominates() {
    let mut policy = permissive_policy();
    policy.autonomous_hardware_enabled = false;
    let decision = evaluate_submission(&qpu_facts(), &policy, 1000.0);
    assert_eq!(decision.decision, Decision::NeedsApproval);
}

#[test]
fn simulator_denied_when_allow_simulator_is_false() {
    let mut policy = AutonomyPolicy::safe_default();
    policy.allow_simulator = false;
    let decision = evaluate_submission(&sim_facts(), &policy, f64::INFINITY);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(!decision.reasons.is_empty());
}

#[test]
fn allows_an_ibm_qpu_submission_within_every_limit_under_a_permissive_policy() {
    let decision = evaluate_submission(&qpu_facts(), &permissive_policy(), 100.0);
    assert_eq!(decision.decision, Decision::Allow);
    assert!(decision.reasons.is_empty());
}

#[test]
fn denies_when_allow_qpu_is_false_even_with_autonomy_enabled() {
    let mut policy = permissive_policy();
    policy.allow_qpu = false;
    let decision = evaluate_submission(&qpu_facts(), &policy, 100.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision
        .reasons
        .iter()
        .any(|r| r.to_lowercase().contains("qpu")));
}

#[test]
fn denies_when_the_provider_is_not_in_a_non_empty_allowlist() {
    let mut facts = qpu_facts();
    facts.provider = "google".to_string();
    let decision = evaluate_submission(&facts, &permissive_policy(), 100.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision
        .reasons
        .iter()
        .any(|r| r.to_lowercase().contains("allowlist")));
}

#[test]
fn allows_any_provider_when_the_allowlist_is_empty() {
    let mut policy = permissive_policy();
    policy.provider_allowlist = Vec::new();
    let mut facts = qpu_facts();
    facts.provider = "google".to_string();
    let decision = evaluate_submission(&facts, &policy, 100.0);
    assert_eq!(decision.decision, Decision::Allow);
}

#[test]
fn denies_when_shots_exceed_max_shots_with_a_shots_specific_reason() {
    let mut facts = qpu_facts();
    facts.shots = 5000;
    let decision = evaluate_submission(&facts, &permissive_policy(), 100.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision
        .reasons
        .iter()
        .any(|r| r.to_lowercase().contains("shots")));
}

#[test]
fn denies_when_qubits_exceed_max_qubits_with_a_qubits_specific_reason() {
    let mut facts = qpu_facts();
    facts.qubits = 64;
    let decision = evaluate_submission(&facts, &permissive_policy(), 100.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision
        .reasons
        .iter()
        .any(|r| r.to_lowercase().contains("qubit")));
}

#[test]
fn denies_when_depth_exceeds_max_circuit_depth_with_a_depth_specific_reason() {
    let mut facts = qpu_facts();
    facts.depth = 5000;
    let decision = evaluate_submission(&facts, &permissive_policy(), 100.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision
        .reasons
        .iter()
        .any(|r| r.to_lowercase().contains("depth")));
}

#[test]
fn collects_a_reason_for_every_independent_limit_violated_at_once() {
    let mut facts = qpu_facts();
    facts.shots = 5000;
    facts.qubits = 64;
    facts.depth = 5000;
    let decision = evaluate_submission(&facts, &permissive_policy(), 100.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision.reasons.len() >= 3);
}

#[test]
fn denies_when_estimated_cost_exceeds_max_spend() {
    let mut facts = qpu_facts();
    facts.estimated_cost = Some(999.0);
    let decision = evaluate_submission(&facts, &permissive_policy(), 1000.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision
        .reasons
        .iter()
        .any(|r| r.to_lowercase().contains("spend limit")));
}

#[test]
fn denies_when_estimated_cost_exceeds_the_remaining_budget_even_under_max_spend() {
    let mut facts = qpu_facts();
    facts.estimated_cost = Some(5.0);
    let decision = evaluate_submission(&facts, &permissive_policy(), 2.0);
    assert_eq!(decision.decision, Decision::Deny);
    assert!(decision
        .reasons
        .iter()
        .any(|r| r.to_lowercase().contains("remaining budget")));
}

#[test]
fn cost_unknown_deny_denies_a_null_cost_submission() {
    let mut policy = permissive_policy();
    policy.cost_unknown_behavior = CostUnknownBehavior::Deny;
    let mut facts = qpu_facts();
    facts.estimated_cost = None;
    let decision = evaluate_submission(&facts, &policy, 100.0);
    assert_eq!(decision.decision, Decision::Deny);
}

#[test]
fn cost_unknown_needs_approval_returns_needs_approval_for_a_null_cost_submission() {
    let mut policy = permissive_policy();
    policy.cost_unknown_behavior = CostUnknownBehavior::NeedsApproval;
    let mut facts = qpu_facts();
    facts.estimated_cost = None;
    let decision = evaluate_submission(&facts, &policy, 100.0);
    assert_eq!(decision.decision, Decision::NeedsApproval);
}

#[test]
fn cost_unknown_reserve_allows_a_null_cost_submission_when_every_other_check_passes() {
    let mut policy = permissive_policy();
    policy.cost_unknown_behavior = CostUnknownBehavior::Reserve;
    let mut facts = qpu_facts();
    facts.estimated_cost = None;
    let decision = evaluate_submission(&facts, &policy, 100.0);
    assert_eq!(decision.decision, Decision::Allow);
}

#[test]
fn a_deny_worthy_limit_violation_still_wins_over_a_needs_approval_worthy_unknown_cost() {
    let mut policy = permissive_policy();
    policy.cost_unknown_behavior = CostUnknownBehavior::NeedsApproval;
    let mut facts = qpu_facts();
    facts.shots = 5000;
    facts.estimated_cost = None;
    let decision = evaluate_submission(&facts, &policy, 100.0);
    assert_eq!(decision.decision, Decision::Deny);
}

#[test]
fn never_panics_for_pathological_inputs() {
    let facts = SubmissionFacts {
        provider: String::new(),
        backend: String::new(),
        shots: -1,
        qubits: -1,
        depth: -1,
        is_simulator: false,
        estimated_cost: Some(f64::NAN),
    };
    let _ = evaluate_submission(&facts, &AutonomyPolicy::safe_default(), 0.0);
}
