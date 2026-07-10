//! Pure, deterministic autonomy policy for hardware submission (Stage R3 port
//! of `src/services/agent/policy.ts`). This is the safety boundary for
//! Dirac's agent runtime: it decides whether a proposed job (simulator or
//! real QPU) may be submitted, independent of anything the model said. No
//! I/O, no randomness, never panics.
//!
//! The default policy is SAFE: autonomous hardware submission is OFF. A real
//! QPU submission under [`AutonomyPolicy::safe_default`] always comes back
//! [`Decision::NeedsApproval`], regardless of every other field — see
//! [`evaluate_submission`] below.
//!
//! Stage R4's orchestrator is the first live caller of this module; until
//! then it is exercised only by its own unit tests.
#![allow(dead_code)] // remove-me: wired up by the Stage R4 orchestrator.

use serde::{Deserialize, Serialize};

/// How to treat a submission whose cost could not be estimated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostUnknownBehavior {
    Deny,
    NeedsApproval,
    Reserve,
}

/// Deterministic autonomy policy governing hardware submission.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutonomyPolicy {
    /// Master switch for autonomous REAL hardware submission. When false,
    /// every real-QPU submission returns `NeedsApproval` regardless of any
    /// other field on this policy. Simulator submissions are governed
    /// separately by `allow_simulator` and are unaffected by this flag.
    pub autonomous_hardware_enabled: bool,
    pub allow_simulator: bool,
    pub allow_qpu: bool,
    /// Empty means "no allowlist restriction" (any provider passes this
    /// check); non-empty restricts to exactly those provider ids.
    pub provider_allowlist: Vec<String>,
    pub max_spend: f64,
    pub max_shots: u32,
    pub max_qubits: u32,
    pub max_circuit_depth: u32,
    pub cost_unknown_behavior: CostUnknownBehavior,
}

impl AutonomyPolicy {
    /// SAFE default: no autonomous real-hardware submission, simulator only.
    pub fn safe_default() -> Self {
        Self {
            autonomous_hardware_enabled: false,
            allow_simulator: true,
            allow_qpu: false,
            provider_allowlist: Vec::new(),
            max_spend: 0.0,
            max_shots: 4096,
            max_qubits: 32,
            max_circuit_depth: 1000,
            cost_unknown_behavior: CostUnknownBehavior::NeedsApproval,
        }
    }
}

impl Default for AutonomyPolicy {
    fn default() -> Self {
        Self::safe_default()
    }
}

/// The facts about a proposed submission that the policy evaluates. Built by
/// the caller (Stage R4's orchestrator/tool executor), never by the model
/// directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubmissionFacts {
    pub provider: String,
    pub backend: String,
    pub shots: i64,
    pub qubits: i64,
    pub depth: i64,
    pub is_simulator: bool,
    /// `None` means the cost could not be estimated; governed by
    /// `cost_unknown_behavior`.
    pub estimated_cost: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
    NeedsApproval,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub decision: Decision,
    pub reasons: Vec<String>,
}

/// Evaluates whether a proposed submission is allowed under `policy`, given
/// `remaining_budget` (the ledger's currently unreserved/unspent headroom).
///
/// Rules (deterministic, independent of any model text):
///  - Simulator path: allowed iff `policy.allow_simulator`.
///  - Real hardware path: `!policy.autonomous_hardware_enabled` dominates and
///    always returns `NeedsApproval`, before any other check runs. If
///    autonomous hardware submission IS enabled, every remaining check
///    (allow_qpu, provider allowlist, shots/qubits/depth ceilings, cost vs
///    max_spend/remaining_budget) is evaluated and every failing check
///    contributes its own reason; any failure denies the submission. A
///    submission is `Allow` only when every check passes.
pub fn evaluate_submission(
    facts: &SubmissionFacts,
    policy: &AutonomyPolicy,
    remaining_budget: f64,
) -> PolicyDecision {
    if facts.is_simulator {
        return if policy.allow_simulator {
            PolicyDecision {
                decision: Decision::Allow,
                reasons: Vec::new(),
            }
        } else {
            PolicyDecision {
                decision: Decision::Deny,
                reasons: vec!["Simulator submissions are disabled by policy.".to_string()],
            }
        };
    }

    if !policy.autonomous_hardware_enabled {
        return PolicyDecision {
            decision: Decision::NeedsApproval,
            reasons: vec![
                "Autonomous hardware submission is disabled. Enable it in Settings to allow paid jobs."
                    .to_string(),
            ],
        };
    }

    let mut deny_reasons: Vec<String> = Vec::new();

    if !policy.allow_qpu {
        deny_reasons.push("QPU submissions are disabled by policy.".to_string());
    }
    if !policy.provider_allowlist.is_empty() && !policy.provider_allowlist.contains(&facts.provider)
    {
        deny_reasons.push(format!(
            "Provider \"{}\" is not in the allowlist.",
            facts.provider
        ));
    }
    if facts.shots > i64::from(policy.max_shots) {
        deny_reasons.push(format!(
            "Requested shots ({}) exceed the policy maximum ({}).",
            facts.shots, policy.max_shots
        ));
    }
    if facts.qubits > i64::from(policy.max_qubits) {
        deny_reasons.push(format!(
            "Circuit qubit count ({}) exceeds the policy maximum ({}).",
            facts.qubits, policy.max_qubits
        ));
    }
    if facts.depth > i64::from(policy.max_circuit_depth) {
        deny_reasons.push(format!(
            "Circuit depth ({}) exceeds the policy maximum ({}).",
            facts.depth, policy.max_circuit_depth
        ));
    }

    let mut cost_needs_approval = false;
    match facts.estimated_cost {
        None => match policy.cost_unknown_behavior {
            CostUnknownBehavior::Deny => {
                deny_reasons.push(
                    "Estimated cost is unknown and policy denies unknown-cost submissions."
                        .to_string(),
                );
            }
            CostUnknownBehavior::NeedsApproval => {
                cost_needs_approval = true;
            }
            // Reserve: cost-unknown is treated as allowable, provided every
            // other check above passed — the caller is expected to reserve a
            // placeholder budget amount before actually submitting.
            CostUnknownBehavior::Reserve => {}
        },
        Some(cost) => {
            if cost > policy.max_spend {
                deny_reasons.push(format!(
                    "Estimated cost ({cost}) exceeds the per-job spend limit ({}).",
                    policy.max_spend
                ));
            }
            if cost > remaining_budget {
                deny_reasons.push(format!(
                    "Estimated cost ({cost}) exceeds the remaining budget ({remaining_budget})."
                ));
            }
        }
    }

    if !deny_reasons.is_empty() {
        return PolicyDecision {
            decision: Decision::Deny,
            reasons: deny_reasons,
        };
    }

    if cost_needs_approval {
        return PolicyDecision {
            decision: Decision::NeedsApproval,
            reasons: vec![
                "Estimated cost is unknown; human approval is required before submission."
                    .to_string(),
            ],
        };
    }

    PolicyDecision {
        decision: Decision::Allow,
        reasons: Vec::new(),
    }
}

#[cfg(test)]
mod tests;
