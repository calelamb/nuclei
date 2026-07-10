//! Policy-gated hardware submission executors (port of
//! `src/services/agent/hardwareSubmitExecutors.ts`).
//!
//! This is the ONLY code path in the agent runtime that can reach a real, paid
//! quantum backend. Every branch is deliberately conservative:
//! - `submit_hardware_job` NEVER calls `submit_port.submit(...)` unless
//!   [`evaluate_submission`] returned [`Decision::Allow`].
//! - Every other outcome (deny, needs_approval, duplicate, unavailable) is
//!   reported back to the model as ordinary `ok:true` evidence — a normal,
//!   expected result, not an exception.
//! - None of these executors ever panic.

use serde_json::{json, Value};

use crate::dirac::analysis::{compare_distributions, DEFAULT_COMPARE_TOLERANCE};
use crate::dirac::kernel::{kernel_language_for, ParseOutcome};
use crate::dirac::policy::{evaluate_submission, Decision, SubmissionFacts};
use crate::dirac::submit::{JobResultsOutcome, SubmitOutcome, SubmitRequest};
use crate::dirac::workspace::hash_content;

use super::{
    ev_fail, ev_ok, get_f64, get_object, get_str, resolve_framework, ToolContext, ToolEvidence,
};

fn is_simulator_backend(provider: &str, backend_name: &str) -> bool {
    provider == "simulator" || backend_name.to_lowercase().starts_with("sim")
}

fn decision_str(decision: Decision) -> &'static str {
    match decision {
        Decision::Allow => "allow",
        Decision::Deny => "deny",
        Decision::NeedsApproval => "needs_approval",
    }
}

pub fn exec_submit_hardware_job(input: &Value, id: &str, ctx: &mut ToolContext) -> ToolEvidence {
    const TOOL: &str = "submit_hardware_job";

    let Some(backend_name) = get_str(input, "backend") else {
        return ev_fail(TOOL, id, "A string \"backend\" is required.", json!({}));
    };
    let Some(shots_f) = get_f64(input, "shots") else {
        return ev_fail(TOOL, id, "A number \"shots\" is required.", json!({}));
    };
    let shots = shots_f as i64;

    let backends = (ctx.get_backends)();
    let Some(backend) = backends.iter().find(|b| b.name == backend_name).cloned() else {
        return ev_fail(
            TOOL,
            id,
            &format!("Backend not available: {backend_name}"),
            json!({ "backend": backend_name }),
        );
    };

    let path = ctx.workspace.active_path();
    let Some(file) = ctx.workspace.read_file(&path) else {
        return ev_fail(
            TOOL,
            id,
            &format!("No active file to submit: {path}"),
            json!({}),
        );
    };
    let language = kernel_language_for(&resolve_framework(ctx, &path));

    // Reuse the last parsed snapshot when present; otherwise parse the active
    // file. A parse failure is a genuine tool error.
    let (qubits, depth) = match ctx.last_snapshot.as_ref() {
        Some(s) => (i64::from(s.qubit_count), i64::from(s.depth)),
        None => match ctx
            .kernel
            .parse(&file.content, &resolve_framework(ctx, &path), &language)
        {
            ParseOutcome::Ok { snapshot } => {
                let dims = (i64::from(snapshot.qubit_count), i64::from(snapshot.depth));
                ctx.last_snapshot = Some(snapshot);
                dims
            }
            ParseOutcome::Err { message, line } => {
                return ev_fail(TOOL, id, &message, json!({ "path": path, "line": line }));
            }
        },
    };

    let is_simulator = is_simulator_backend(&backend.provider, &backend.name);
    let cost_query = SubmissionFacts {
        provider: backend.provider.clone(),
        backend: backend.name.clone(),
        shots,
        qubits,
        depth,
        is_simulator,
        estimated_cost: None,
    };
    let estimated_cost = (ctx.estimate_cost)(&cost_query);

    let facts = SubmissionFacts {
        estimated_cost,
        ..cost_query
    };

    let remaining = ctx.ledger.remaining();
    let decision = evaluate_submission(&facts, ctx.policy, remaining);

    // SAFETY GATE: submit_port is only ever reached below this line, and only
    // when decision == Allow.
    if decision.decision != Decision::Allow {
        return ev_ok(
            TOOL,
            id,
            json!({
                "submitted": false,
                "decision": decision_str(decision.decision),
                "reasons": decision.reasons,
            }),
        );
    }

    if !ctx.submit_port.available() {
        return ev_ok(
            TOOL,
            id,
            json!({
                "submitted": false,
                "decision": "unavailable",
                "reasons": ["No hardware submission channel configured."],
            }),
        );
    }

    let idempotency_key = format!("{}:{}:{}", backend.name, shots, hash_content(&file.content));
    if ctx.ledger.has_submitted(&idempotency_key) {
        return ev_ok(
            TOOL,
            id,
            json!({
                "submitted": false,
                "decision": "duplicate",
                "job_id": ctx.ledger.submitted_job_id(&idempotency_key),
            }),
        );
    }

    let mut reservation_id: Option<String> = None;
    if let Some(cost) = estimated_cost {
        if cost > 0.0 {
            match ctx.ledger.reserve(cost) {
                Ok(res_id) => reservation_id = Some(res_id),
                Err(reason) => {
                    return ev_ok(
                        TOOL,
                        id,
                        json!({
                            "submitted": false,
                            "decision": "deny",
                            "reasons": [format!("budget: {reason}")],
                        }),
                    );
                }
            }
        }
    }

    let request = SubmitRequest {
        provider: backend.provider.clone(),
        backend: backend.name.clone(),
        shots: shots.max(0) as u32,
        code: file.content.clone(),
        language,
    };

    match ctx.submit_port.submit(&request) {
        SubmitOutcome::Err { message } => {
            if let Some(res_id) = &reservation_id {
                ctx.ledger.release(res_id);
            }
            ev_fail(
                TOOL,
                id,
                &message,
                json!({ "decision": "allow", "submitted": false }),
            )
        }
        SubmitOutcome::Ok { job_id } => {
            if let Some(res_id) = &reservation_id {
                ctx.ledger.commit(res_id, estimated_cost.unwrap_or(0.0));
            }
            ctx.ledger
                .record_submission(idempotency_key, job_id.clone());
            ev_ok(
                TOOL,
                id,
                json!({ "submitted": true, "job_id": job_id, "decision": "allow" }),
            )
        }
    }
}

pub fn exec_poll_hardware_job(input: &Value, id: &str, ctx: &ToolContext) -> ToolEvidence {
    const TOOL: &str = "poll_hardware_job";
    let Some(job_id) = get_str(input, "job_id") else {
        return ev_fail(TOOL, id, "A string \"job_id\" is required.", json!({}));
    };
    if !ctx.submit_port.available() {
        return ev_ok(
            TOOL,
            id,
            json!({ "available": false, "reasons": ["No hardware submission channel configured."] }),
        );
    }
    let status = ctx.submit_port.status(&job_id);
    ev_ok(
        TOOL,
        id,
        json!({
            "available": true,
            "job_id": status.job_id,
            "status": status.status,
            "queue_position": status.queue_position,
        }),
    )
}

pub fn exec_cancel_hardware_job(input: &Value, id: &str, ctx: &ToolContext) -> ToolEvidence {
    const TOOL: &str = "cancel_hardware_job";
    let Some(job_id) = get_str(input, "job_id") else {
        return ev_fail(TOOL, id, "A string \"job_id\" is required.", json!({}));
    };
    if !ctx.submit_port.available() {
        return ev_ok(
            TOOL,
            id,
            json!({ "available": false, "reasons": ["No hardware submission channel configured."] }),
        );
    }
    let cancelled = ctx.submit_port.cancel(&job_id);
    ev_ok(
        TOOL,
        id,
        json!({ "job_id": job_id, "cancelled": cancelled }),
    )
}

pub fn exec_analyze_hardware_result(input: &Value, id: &str, ctx: &ToolContext) -> ToolEvidence {
    const TOOL: &str = "analyze_hardware_result";
    let Some(job_id) = get_str(input, "job_id") else {
        return ev_fail(TOOL, id, "A string \"job_id\" is required.", json!({}));
    };
    if !ctx.submit_port.available() {
        return ev_ok(
            TOOL,
            id,
            json!({ "available": false, "reasons": ["No hardware submission channel configured."] }),
        );
    }

    match ctx.submit_port.results(&job_id) {
        JobResultsOutcome::Err { message } => {
            ev_fail(TOOL, id, &message, json!({ "job_id": job_id }))
        }
        JobResultsOutcome::Ok {
            job_id: rid,
            probabilities,
        } => {
            let mut facts = json!({
                "available": true,
                "job_id": rid,
                "probabilities": probabilities,
            });

            if let Some(expected_obj) = get_object(input, "expected_probabilities") {
                let expected: std::collections::HashMap<String, f64> = expected_obj
                    .iter()
                    .map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0)))
                    .collect();
                let report =
                    compare_distributions(&probabilities, &expected, DEFAULT_COMPARE_TOLERANCE);
                if let Some(obj) = facts.as_object_mut() {
                    obj.insert(
                        "comparison".to_string(),
                        serde_json::to_value(&report).unwrap_or(Value::Null),
                    );
                }
            }

            ev_ok(TOOL, id, facts)
        }
    }
}
