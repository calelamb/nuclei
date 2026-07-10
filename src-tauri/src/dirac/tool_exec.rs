//! Tool executor (Stage R4 port of `src/services/agent/toolExecutors.ts` plus
//! the split-out executor files). Dispatches one model tool call to the
//! workspace / kernel / analysis / policy / budget / submit layers and returns
//! deterministic [`ToolEvidence`] — the structured `tool_result` fed back to
//! the model. NEVER panics: malformed input or an unknown tool becomes
//! `ok: false` evidence.
//!
//! Split by concern (mirroring the TS module boundaries) to stay under the
//! file-size budget:
//! - this file — [`ToolContext`], [`ToolEvidence`], input helpers, shared
//!   parse/framework resolution, and the [`execute_tool`] dispatch.
//! - [`local`] — the local-simulation executors (inspect/read/patch/rollback/
//!   parse/validate/estimate/run/compare/finish).
//! - [`hardware`] — the policy-gated submit/poll/cancel/analyze executors.
//! - [`invariant`] — `check_algorithm_invariant`.
//! - [`preview`] — `plan_hardware_run` + `preview_backend_transpilation`.

pub mod hardware;
pub mod invariant;
pub mod local;
pub mod preview;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::dirac::analysis::{BackendInfo, CircuitSnapshot};
use crate::dirac::budget::BudgetLedger;
use crate::dirac::kernel::{kernel_language_for, AgentKernel, ParseOutcome, SimulationResult};
use crate::dirac::policy::{AutonomyPolicy, SubmissionFacts};
use crate::dirac::submit::SubmitPort;
use crate::dirac::workspace::Workspace;

/// The structured, deterministic result of executing one tool call — what gets
/// fed back to the model as a `tool_result`, never a raw exception (port of the
/// TS `ToolEvidence`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolEvidence {
    pub tool_call_id: String,
    pub tool: String,
    pub ok: bool,
    pub facts: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<String>,
}

/// Cost estimator: returns `None` when the cost cannot be determined (the TS
/// default, which the safe policy treats as `needs_approval` for real hardware).
pub type CostEstimator<'a> = dyn Fn(&SubmissionFacts) -> Option<f64> + 'a;

/// Backend accessor: the currently known hardware backends (empty = none
/// connected, a normal state).
pub type BackendProvider<'a> = dyn Fn() -> Vec<BackendInfo> + 'a;

/// The dependency bag every tool executor is invoked with (port of the TS
/// `ToolContext`). Owns mutable slots for the most recent snapshot/result so
/// `compare_quantum_results` / `check_algorithm_invariant` can reference them
/// without threading them through every call.
pub struct ToolContext<'a> {
    pub kernel: &'a dyn AgentKernel,
    pub workspace: &'a mut dyn Workspace,
    /// Autonomy policy gating submit_hardware_job — THE safety boundary: a
    /// real-QPU submission is never sent unless `evaluate_submission` returns
    /// `Allow`.
    pub policy: &'a AutonomyPolicy,
    /// Spend ledger for reserve/commit/release and submission idempotency.
    pub ledger: &'a mut BudgetLedger,
    /// The only channel that can reach real hardware.
    pub submit_port: &'a dyn SubmitPort,
    pub get_backends: &'a BackendProvider<'a>,
    pub estimate_cost: &'a CostEstimator<'a>,
    /// Most recently parsed circuit snapshot (populated by parse/validate/
    /// estimate/plan; reused by submit).
    pub last_snapshot: Option<CircuitSnapshot>,
    /// Most recent simulation result (populated by run_simulation; read by
    /// compare / check_algorithm_invariant).
    pub last_result: Option<SimulationResult>,
    /// Per-path hash the loop last observed, used as apply_patch's conflict
    /// baseline. Updated on every successful patch.
    pub last_known_hash: HashMap<String, String>,
}

// --- evidence helpers -------------------------------------------------------

pub(crate) fn ev_ok(tool: &str, id: &str, facts: Value) -> ToolEvidence {
    ToolEvidence {
        tool_call_id: id.to_string(),
        tool: tool.to_string(),
        ok: true,
        facts,
        diagnostics: None,
    }
}

pub(crate) fn ev_fail(tool: &str, id: &str, diagnostics: &str, facts: Value) -> ToolEvidence {
    ToolEvidence {
        tool_call_id: id.to_string(),
        tool: tool.to_string(),
        ok: false,
        facts,
        diagnostics: Some(diagnostics.to_string()),
    }
}

// --- input accessors (port of toolHelpers.ts) -------------------------------

pub(crate) fn get_str(input: &Value, key: &str) -> Option<String> {
    input.get(key).and_then(Value::as_str).map(str::to_string)
}

pub(crate) fn get_f64(input: &Value, key: &str) -> Option<f64> {
    input.get(key).and_then(Value::as_f64)
}

pub(crate) fn get_bool(input: &Value, key: &str) -> Option<bool> {
    input.get(key).and_then(Value::as_bool)
}

pub(crate) fn get_object<'v>(input: &'v Value, key: &str) -> Option<&'v Map<String, Value>> {
    input.get(key).and_then(Value::as_object)
}

/// Does the input carry `key` at all (even if the wrong type)? Used to
/// distinguish "omitted" from "present but invalid", matching the TS
/// `input.x === undefined` checks.
pub(crate) fn has_key(input: &Value, key: &str) -> bool {
    input.get(key).is_some()
}

// --- shared resolution ------------------------------------------------------

pub(crate) fn resolve_path(input: &Value, ctx: &ToolContext) -> String {
    get_str(input, "path").unwrap_or_else(|| ctx.workspace.active_path())
}

/// Which framework a path's contents should be interpreted as (port of
/// `defaultFrameworkResolver`): the workspace file's framework when known,
/// else inferred from the extension.
pub(crate) fn resolve_framework(ctx: &ToolContext, path: &str) -> String {
    if let Some(file) = ctx.workspace.read_file(path) {
        return file.framework;
    }
    if path.ends_with(".qs") {
        "qsharp".to_string()
    } else {
        "qiskit".to_string()
    }
}

/// Parse the resolved file and store the snapshot in `ctx.last_snapshot`.
/// Shared by parse/validate/estimate/plan. On any failure returns the evidence
/// to hand straight back to the model.
pub(crate) fn parse_active(
    ctx: &mut ToolContext,
    input: &Value,
    tool: &str,
    id: &str,
) -> Result<(String, CircuitSnapshot), ToolEvidence> {
    let path = resolve_path(input, ctx);
    let Some(file) = ctx.workspace.read_file(&path) else {
        return Err(ev_fail(
            tool,
            id,
            &format!("No file at path: {path}"),
            json!({}),
        ));
    };
    let framework = resolve_framework(ctx, &path);
    let language = kernel_language_for(&framework);
    match ctx.kernel.parse(&file.content, &framework, &language) {
        ParseOutcome::Ok { snapshot } => {
            ctx.last_snapshot = Some(snapshot.clone());
            Ok((path, snapshot))
        }
        ParseOutcome::Err { message, line } => Err(ev_fail(
            tool,
            id,
            &message,
            json!({ "path": path, "line": line }),
        )),
    }
}

/// Dispatch one tool call to its executor. Unknown tools and malformed input
/// resolve to `ok:false` evidence — this function never panics.
pub fn execute_tool(
    tool_call_id: &str,
    name: &str,
    input: &Value,
    ctx: &mut ToolContext,
) -> ToolEvidence {
    // Normalize a non-object input to `{}` so every executor's accessors see a
    // consistent shape (mirrors `asRecord(input) ?? {}`).
    let normalized = if input.is_object() {
        input.clone()
    } else {
        json!({})
    };
    let input = &normalized;

    match name {
        "inspect_project" => local::exec_inspect_project(tool_call_id, ctx),
        "read_quantum_file" => local::exec_read_quantum_file(input, tool_call_id, ctx),
        "apply_patch" => local::exec_apply_patch(input, tool_call_id, ctx),
        "rollback_patch" => local::exec_rollback_patch(input, tool_call_id, ctx),
        "parse_quantum_program" => local::exec_parse_quantum_program(input, tool_call_id, ctx),
        "validate_quantum_program" => {
            local::exec_validate_quantum_program(input, tool_call_id, ctx)
        }
        "estimate_quantum_resources" => {
            local::exec_estimate_quantum_resources(input, tool_call_id, ctx)
        }
        "run_simulation" => local::exec_run_simulation(input, tool_call_id, ctx),
        "compare_quantum_results" => local::exec_compare_quantum_results(input, tool_call_id, ctx),
        "check_algorithm_invariant" => {
            invariant::exec_check_algorithm_invariant(input, tool_call_id, ctx)
        }
        "plan_hardware_run" => preview::exec_plan_hardware_run(input, tool_call_id, ctx),
        "preview_backend_transpilation" => {
            preview::exec_preview_backend_transpilation(input, tool_call_id, ctx)
        }
        "submit_hardware_job" => hardware::exec_submit_hardware_job(input, tool_call_id, ctx),
        "poll_hardware_job" => hardware::exec_poll_hardware_job(input, tool_call_id, ctx),
        "cancel_hardware_job" => hardware::exec_cancel_hardware_job(input, tool_call_id, ctx),
        "analyze_hardware_result" => {
            hardware::exec_analyze_hardware_result(input, tool_call_id, ctx)
        }
        "finish" => local::exec_finish(input, tool_call_id),
        other => ev_fail(
            other,
            tool_call_id,
            &format!("Unknown tool: {other}"),
            json!({}),
        ),
    }
}

#[cfg(test)]
pub(crate) mod test_support;

#[cfg(test)]
mod tests;
