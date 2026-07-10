//! Atomic, deterministic, serializable spend ledger for hardware submissions
//! (Stage R3 port of `src/services/agent/budgetLedger.ts`).
//!
//! Tracks a reserve -> commit/release lifecycle so a submission's cost is
//! carved out of the remaining budget BEFORE the submit port is called, and
//! only actually spent once the provider confirms the job. Also tracks
//! submission idempotency keys so the same logical submission is never sent
//! twice.
//!
//! Stage R4's orchestrator is the first live caller of this module; until
//! then it is exercised only by its own unit tests.
#![allow(dead_code)] // remove-me: wired up by the Stage R4 orchestrator.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Result of a reservation attempt. Mirrors the TS `ReserveResult` union
/// (`ReserveSuccess | ReserveFailure`) as a Rust `Result`.
pub type ReserveResult = Result<String, String>;

/// Serializable snapshot of a [`BudgetLedger`], used by `to_json`/`from_json`.
/// `reservations` and `submitted` are kept as ordered vecs of pairs (rather
/// than maps) so the JSON shape is stable and easy to assert against in
/// tests, matching the TS `BudgetLedgerJSON` shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BudgetLedgerJson {
    pub ceiling: f64,
    pub spent: f64,
    pub reserved: f64,
    pub reservations: Vec<(String, f64)>,
    pub submitted_keys: Vec<(String, String)>,
}

/// Injectable reservation-id generator. A counter-based default keeps tests
/// deterministic without pulling in a UUID dependency; callers may supply
/// their own (e.g. a UUID-backed one) for production use.
type IdGen = Box<dyn Fn() -> String + Send + Sync>;

fn counting_id_gen(prefix: &'static str) -> IdGen {
    let counter = std::sync::atomic::AtomicU64::new(0);
    Box::new(move || {
        let next = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        format!("{prefix}_{next}")
    })
}

/// Atomic, deterministic budget ledger over a fixed `ceiling`. No I/O, no
/// randomness beyond the injected id generator.
pub struct BudgetLedger {
    ceiling: f64,
    spent: f64,
    reserved: f64,
    reservations: HashMap<String, f64>,
    submitted: HashMap<String, String>,
    id_gen: IdGen,
}

impl BudgetLedger {
    /// Creates a new ledger with a default `res_N` id generator.
    pub fn new(ceiling: f64) -> Self {
        Self::with_id_gen(ceiling, counting_id_gen("res"))
    }

    /// Creates a new ledger with an injected id generator, for deterministic
    /// tests or a production UUID-backed generator.
    pub fn with_id_gen(ceiling: f64, id_gen: IdGen) -> Self {
        Self {
            ceiling,
            spent: 0.0,
            reserved: 0.0,
            reservations: HashMap::new(),
            submitted: HashMap::new(),
            id_gen,
        }
    }

    /// Unreserved, unspent headroom remaining against the ceiling.
    pub fn remaining(&self) -> f64 {
        self.ceiling - self.spent - self.reserved
    }

    /// Carves `amount` out of the remaining budget as a reservation. Fails
    /// (without mutating state) for a negative amount or when the
    /// reservation would push spent + reserved past the ceiling.
    pub fn reserve(&mut self, amount: f64) -> ReserveResult {
        if amount < 0.0 {
            return Err("Reservation amount must be non-negative.".to_string());
        }
        if self.spent + self.reserved + amount > self.ceiling {
            return Err("Insufficient remaining budget for this reservation.".to_string());
        }

        let reservation_id = (self.id_gen)();
        self.reservations.insert(reservation_id.clone(), amount);
        self.reserved += amount;
        Ok(reservation_id)
    }

    /// Converts a reservation into actual spend. `actual_cost` may differ
    /// from the amount originally reserved (e.g. a provider's final
    /// invoice). Returns false for an unknown or already-resolved
    /// reservation id.
    pub fn commit(&mut self, reservation_id: &str, actual_cost: f64) -> bool {
        let Some(amount) = self.reservations.remove(reservation_id) else {
            return false;
        };
        self.reserved -= amount;
        self.spent += actual_cost;
        true
    }

    /// Releases a reservation without spending it (e.g. the submission
    /// failed). Returns false for an unknown or already-resolved
    /// reservation id.
    pub fn release(&mut self, reservation_id: &str) -> bool {
        let Some(amount) = self.reservations.remove(reservation_id) else {
            return false;
        };
        self.reserved -= amount;
        true
    }

    pub fn has_submitted(&self, key: &str) -> bool {
        self.submitted.contains_key(key)
    }

    pub fn record_submission(&mut self, key: impl Into<String>, job_id: impl Into<String>) {
        self.submitted.insert(key.into(), job_id.into());
    }

    pub fn submitted_job_id(&self, key: &str) -> Option<&str> {
        self.submitted.get(key).map(String::as_str)
    }

    /// Serializes this ledger's state (not the id generator).
    pub fn to_json(&self) -> BudgetLedgerJson {
        BudgetLedgerJson {
            ceiling: self.ceiling,
            spent: self.spent,
            reserved: self.reserved,
            reservations: self
                .reservations
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect(),
            submitted_keys: self
                .submitted
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        }
    }

    /// Rehydrates a ledger from a prior `to_json()` snapshot. An `id_gen` may
    /// be supplied for deterministic tests; otherwise a fresh monotonic
    /// counter is used for any reservations made after restoration.
    pub fn from_json(json: &BudgetLedgerJson, id_gen: IdGen) -> Self {
        let mut ledger = Self::with_id_gen(json.ceiling, id_gen);
        ledger.spent = json.spent;
        ledger.reserved = json.reserved;
        for (id, amount) in &json.reservations {
            ledger.reservations.insert(id.clone(), *amount);
        }
        for (key, job_id) in &json.submitted_keys {
            ledger.submitted.insert(key.clone(), job_id.clone());
        }
        ledger
    }
}

#[cfg(test)]
mod tests;
