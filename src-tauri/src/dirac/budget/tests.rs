use super::*;

fn make_id_gen(prefix: &'static str) -> IdGen {
    counting_id_gen(prefix)
}

#[test]
fn starts_with_the_full_ceiling_as_remaining() {
    let ledger = BudgetLedger::new(100.0);
    assert_eq!(ledger.remaining(), 100.0);
}

#[test]
fn reserve_reduces_remaining_and_returns_a_deterministic_reservation_id() {
    let mut ledger = BudgetLedger::with_id_gen(100.0, make_id_gen("res"));
    let result = ledger.reserve(30.0);
    assert_eq!(result, Ok("res_1".to_string()));
    assert_eq!(ledger.remaining(), 70.0);
}

#[test]
fn reserve_fails_for_a_negative_amount_without_mutating_state() {
    let mut ledger = BudgetLedger::new(100.0);
    let result = ledger.reserve(-5.0);
    assert!(result.is_err());
    assert_eq!(ledger.remaining(), 100.0);
}

#[test]
fn reserve_fails_when_it_would_push_spent_plus_reserved_past_the_ceiling() {
    let mut ledger = BudgetLedger::new(100.0);
    assert!(ledger.reserve(80.0).is_ok());
    assert!(ledger.reserve(30.0).is_err());
    assert_eq!(ledger.remaining(), 20.0);
}

#[test]
fn reserve_exactly_up_to_the_ceiling_succeeds() {
    let mut ledger = BudgetLedger::new(100.0);
    assert!(ledger.reserve(100.0).is_ok());
    assert_eq!(ledger.remaining(), 0.0);
}

#[test]
fn commit_moves_a_reservation_from_reserved_to_spent() {
    let mut ledger = BudgetLedger::new(100.0);
    let reservation_id = ledger.reserve(30.0).expect("reserve should succeed");
    assert!(ledger.commit(&reservation_id, 25.0));
    // The reservation is released (30 freed) and the actual cost (25)
    // spent, so remaining reflects the true cost, not the estimate.
    assert_eq!(ledger.remaining(), 75.0);
}

#[test]
fn commit_on_an_unknown_reservation_id_fails_without_mutating_state() {
    let mut ledger = BudgetLedger::new(100.0);
    assert!(!ledger.commit("nope", 10.0));
    assert_eq!(ledger.remaining(), 100.0);
}

#[test]
fn commit_on_an_already_committed_reservation_id_fails_no_double_spend() {
    let mut ledger = BudgetLedger::new(100.0);
    let reservation_id = ledger.reserve(30.0).expect("reserve should succeed");
    assert!(ledger.commit(&reservation_id, 30.0));
    assert!(!ledger.commit(&reservation_id, 30.0));
    assert_eq!(ledger.remaining(), 70.0);
}

#[test]
fn release_frees_a_reservation_without_touching_spent() {
    let mut ledger = BudgetLedger::new(100.0);
    let reservation_id = ledger.reserve(40.0).expect("reserve should succeed");
    assert!(ledger.release(&reservation_id));
    assert_eq!(ledger.remaining(), 100.0);
}

#[test]
fn release_on_an_unknown_reservation_id_fails() {
    let mut ledger = BudgetLedger::new(100.0);
    assert!(!ledger.release("nope"));
}

#[test]
fn a_released_reservation_frees_exactly_its_own_budget_unaffected_by_others() {
    let mut ledger = BudgetLedger::with_id_gen(100.0, make_id_gen("res"));
    let a = ledger.reserve(20.0).expect("reserve a");
    let _b = ledger.reserve(30.0).expect("reserve b");
    assert_eq!(ledger.remaining(), 50.0);
    ledger.release(&a);
    assert_eq!(ledger.remaining(), 70.0);
}

#[test]
fn idempotency_has_submitted_record_submission_submitted_job_id_round_trip() {
    let mut ledger = BudgetLedger::new(100.0);
    assert!(!ledger.has_submitted("key-1"));
    assert_eq!(ledger.submitted_job_id("key-1"), None);

    ledger.record_submission("key-1", "job-abc");

    assert!(ledger.has_submitted("key-1"));
    assert_eq!(ledger.submitted_job_id("key-1"), Some("job-abc"));
    assert!(!ledger.has_submitted("key-2"));
}

#[test]
fn to_json_from_json_round_trips_ceiling_spent_reserved_reservations_and_submissions() {
    let mut ledger = BudgetLedger::with_id_gen(100.0, make_id_gen("res"));
    let reservation_id = ledger.reserve(20.0).expect("reserve should succeed");
    ledger.record_submission("key-1", "job-abc");

    let snapshot = ledger.to_json();
    assert_eq!(snapshot.ceiling, 100.0);
    assert_eq!(snapshot.spent, 0.0);
    assert_eq!(snapshot.reserved, 20.0);
    assert_eq!(snapshot.reservations, vec![(reservation_id.clone(), 20.0)]);
    assert_eq!(
        snapshot.submitted_keys,
        vec![("key-1".to_string(), "job-abc".to_string())]
    );

    let mut restored = BudgetLedger::from_json(&snapshot, make_id_gen("res"));
    assert_eq!(restored.remaining(), 80.0);
    assert!(restored.has_submitted("key-1"));
    assert_eq!(restored.submitted_job_id("key-1"), Some("job-abc"));

    // The restored reservation can still be committed/released by its
    // original id.
    assert!(restored.commit(&reservation_id, 20.0));
    assert_eq!(restored.remaining(), 80.0);
}

#[test]
fn from_json_restores_a_ledger_that_can_continue_making_new_reservations() {
    let ledger = BudgetLedger::new(50.0);
    let snapshot = ledger.to_json();
    let mut restored = BudgetLedger::from_json(&snapshot, make_id_gen("post"));
    let result = restored.reserve(10.0);
    assert_eq!(result, Ok("post_1".to_string()));
    assert_eq!(restored.remaining(), 40.0);
}
