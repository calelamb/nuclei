//! Local-simulation tool executors (port of the toolExecutors.ts cases that
//! don't touch hardware): inspect/read/patch/rollback/parse/validate/estimate/
//! run/compare/finish. Split out of `tool_exec.rs` to keep that file under the
//! project's file-size budget. Never panic: malformed input becomes `ok:false`
//! evidence.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::dirac::analysis::{
    compare_distributions, estimate_resources, validate_program, DiagnosticSeverity,
};
use crate::dirac::kernel::{kernel_language_for, SimOutcome};
use crate::dirac::workspace::ApplyPatchResult;

use super::{
    ev_fail, ev_ok, get_bool, get_f64, get_object, get_str, has_key, parse_active,
    resolve_framework, resolve_path, ToolContext, ToolEvidence,
};

pub(crate) fn exec_inspect_project(id: &str, ctx: &ToolContext) -> ToolEvidence {
    let files: Vec<Value> = ctx
        .workspace
        .list_files()
        .into_iter()
        .map(|f| json!({ "path": f.path, "framework": f.framework, "dirty": f.dirty }))
        .collect();
    ev_ok(
        "inspect_project",
        id,
        json!({ "files": files, "active_path": ctx.workspace.active_path() }),
    )
}

pub(crate) fn exec_read_quantum_file(input: &Value, id: &str, ctx: &ToolContext) -> ToolEvidence {
    let Some(path) = get_str(input, "path") else {
        return ev_fail(
            "read_quantum_file",
            id,
            "A string \"path\" is required.",
            json!({}),
        );
    };
    let Some(file) = ctx.workspace.read_file(&path) else {
        return ev_fail(
            "read_quantum_file",
            id,
            &format!("No file at path: {path}"),
            json!({}),
        );
    };
    ev_ok(
        "read_quantum_file",
        id,
        json!({
            "path": file.path,
            "framework": file.framework,
            "content": file.content,
            "dirty": file.dirty,
        }),
    )
}

pub(crate) fn exec_apply_patch(input: &Value, id: &str, ctx: &mut ToolContext) -> ToolEvidence {
    let path = get_str(input, "path");
    let new_content = get_str(input, "new_content");
    let rationale = get_str(input, "rationale");

    let Some(path) = path else {
        return ev_fail(
            "apply_patch",
            id,
            "A string \"path\" is required.",
            json!({}),
        );
    };
    let Some(new_content) = new_content else {
        return ev_fail(
            "apply_patch",
            id,
            "A string \"new_content\" is required.",
            json!({}),
        );
    };
    let Some(rationale) = rationale else {
        return ev_fail(
            "apply_patch",
            id,
            "A string \"rationale\" is required.",
            json!({}),
        );
    };

    let expected = ctx.last_known_hash.get(&path).cloned();
    let result = ctx
        .workspace
        .apply_patch(&path, &new_content, expected.as_deref());

    match result {
        ApplyPatchResult::Conflict { current_hash } => ev_fail(
            "apply_patch",
            id,
            "The file changed since it was last observed — re-read it before patching.",
            json!({ "conflict": true, "path": path, "current_hash": current_hash }),
        ),
        ApplyPatchResult::Applied(txn) => {
            ctx.last_known_hash
                .insert(path.clone(), txn.after_hash.clone());
            ev_ok(
                "apply_patch",
                id,
                json!({
                    "transaction_id": txn.id,
                    "path": txn.path,
                    "rationale": rationale,
                    "before_hash": txn.before_hash,
                    "after_hash": txn.after_hash,
                }),
            )
        }
    }
}

pub(crate) fn exec_rollback_patch(input: &Value, id: &str, ctx: &mut ToolContext) -> ToolEvidence {
    let Some(txn_id) = get_str(input, "transaction_id") else {
        return ev_fail(
            "rollback_patch",
            id,
            "A string \"transaction_id\" is required.",
            json!({}),
        );
    };
    if ctx.workspace.rollback(&txn_id) {
        ev_ok(
            "rollback_patch",
            id,
            json!({ "transaction_id": txn_id, "rolled_back": true }),
        )
    } else {
        ev_fail(
            "rollback_patch",
            id,
            "Rollback failed — the transaction is unknown, already rolled back, or the file changed since.",
            json!({ "transaction_id": txn_id, "rolled_back": false }),
        )
    }
}

pub(crate) fn exec_parse_quantum_program(
    input: &Value,
    id: &str,
    ctx: &mut ToolContext,
) -> ToolEvidence {
    let (path, snapshot) = match parse_active(ctx, input, "parse_quantum_program", id) {
        Ok(pair) => pair,
        Err(ev) => return ev,
    };
    ev_ok(
        "parse_quantum_program",
        id,
        json!({
            "path": path,
            "framework": snapshot.framework,
            "qubit_count": snapshot.qubit_count,
            "classical_bit_count": snapshot.classical_bit_count,
            "depth": snapshot.depth,
            "gate_count": snapshot.gates.len(),
        }),
    )
}

pub(crate) fn exec_validate_quantum_program(
    input: &Value,
    id: &str,
    ctx: &mut ToolContext,
) -> ToolEvidence {
    let (path, snapshot) = match parse_active(ctx, input, "validate_quantum_program", id) {
        Ok(pair) => pair,
        Err(ev) => return ev,
    };
    let diagnostics = validate_program(&snapshot);
    let error_count = diagnostics
        .iter()
        .filter(|d| d.severity == DiagnosticSeverity::Error)
        .count();
    let warning_count = diagnostics
        .iter()
        .filter(|d| d.severity == DiagnosticSeverity::Warning)
        .count();
    let resources = estimate_resources(&snapshot);

    let facts = json!({
        "path": path,
        "diagnostics": diagnostics,
        "error_count": error_count,
        "warning_count": warning_count,
        "resources": resources,
    });

    let mut evidence = ev_ok("validate_quantum_program", id, facts);
    if error_count > 0 {
        let summary = diagnostics
            .iter()
            .filter(|d| d.severity == DiagnosticSeverity::Error)
            .map(|d| format!("[{}] {}", d.code, d.message))
            .collect::<Vec<_>>()
            .join("; ");
        evidence.diagnostics = Some(summary);
    }
    evidence
}

pub(crate) fn exec_estimate_quantum_resources(
    input: &Value,
    id: &str,
    ctx: &mut ToolContext,
) -> ToolEvidence {
    let (path, snapshot) = match parse_active(ctx, input, "estimate_quantum_resources", id) {
        Ok(pair) => pair,
        Err(ev) => return ev,
    };
    let resources = estimate_resources(&snapshot);
    // Spread the resource fields into facts alongside `path`, matching the TS
    // `{ path, ...resources }`.
    let mut facts = serde_json::to_value(&resources).unwrap_or_else(|_| json!({}));
    if let Some(obj) = facts.as_object_mut() {
        obj.insert("path".to_string(), json!(path));
    }
    ev_ok("estimate_quantum_resources", id, facts)
}

pub(crate) fn exec_run_simulation(input: &Value, id: &str, ctx: &mut ToolContext) -> ToolEvidence {
    let path = resolve_path(input, ctx);
    let Some(file) = ctx.workspace.read_file(&path) else {
        return ev_fail(
            "run_simulation",
            id,
            &format!("No file at path: {path}"),
            json!({}),
        );
    };

    let shots = if has_key(input, "shots") {
        match get_f64(input, "shots") {
            Some(n) if n >= 0.0 => n as u32,
            _ => {
                return ev_fail(
                    "run_simulation",
                    id,
                    "If provided, \"shots\" must be a number.",
                    json!({}),
                )
            }
        }
    } else {
        1024
    };

    let framework = resolve_framework(ctx, &path);
    let language = kernel_language_for(&framework);
    match ctx
        .kernel
        .simulate(&file.content, shots, &framework, &language)
    {
        SimOutcome::Err { message, line } => ev_fail(
            "run_simulation",
            id,
            &message,
            json!({ "path": path, "line": line }),
        ),
        SimOutcome::Ok { result } => {
            let facts = json!({
                "path": path,
                "probabilities": result.probabilities,
                "measurements": result.measurements,
                "execution_time_ms": result.execution_time_ms,
                "shot_count": result.shot_count,
            });
            ctx.last_result = Some(result);
            ev_ok("run_simulation", id, facts)
        }
    }
}

const DEFAULT_TOLERANCE: f64 = 0.05;

pub(crate) fn exec_compare_quantum_results(
    input: &Value,
    id: &str,
    ctx: &ToolContext,
) -> ToolEvidence {
    let Some(expected_obj) = get_object(input, "expected_probabilities") else {
        return ev_fail(
            "compare_quantum_results",
            id,
            "An \"expected_probabilities\" object is required.",
            json!({}),
        );
    };

    let tolerance = if has_key(input, "tolerance") {
        match get_f64(input, "tolerance") {
            Some(t) => t,
            None => {
                return ev_fail(
                    "compare_quantum_results",
                    id,
                    "If provided, \"tolerance\" must be a number.",
                    json!({}),
                )
            }
        }
    } else {
        DEFAULT_TOLERANCE
    };

    let Some(actual) = ctx.last_result.as_ref() else {
        return ev_fail(
            "compare_quantum_results",
            id,
            "No simulation result available — call run_simulation first.",
            json!({}),
        );
    };

    let expected: HashMap<String, f64> = expected_obj
        .iter()
        .map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0)))
        .collect();

    let report = compare_distributions(&actual.probabilities, &expected, tolerance);

    // Preserve the object-keyed perState shape alongside the ordered array.
    let mut per_state = Map::new();
    for entry in &report.per_state {
        per_state.insert(
            entry.state.clone(),
            json!({ "expected": entry.expected, "actual": entry.actual, "delta": entry.delta }),
        );
    }

    ev_ok(
        "compare_quantum_results",
        id,
        json!({
            "matches": report.matches,
            "worst_delta": report.worst_delta,
            "tolerance": tolerance,
            "per_state": per_state,
            "total_variation_distance": report.total_variation_distance,
            "per_state_ordered": report.per_state,
        }),
    )
}

pub(crate) fn exec_finish(input: &Value, id: &str) -> ToolEvidence {
    let summary = get_str(input, "summary");
    let success = get_bool(input, "success");

    let Some(summary) = summary else {
        return ev_fail("finish", id, "A string \"summary\" is required.", json!({}));
    };
    let Some(success) = success else {
        return ev_fail(
            "finish",
            id,
            "A boolean \"success\" is required.",
            json!({}),
        );
    };
    ev_ok(
        "finish",
        id,
        json!({ "summary": summary, "success": success }),
    )
}
