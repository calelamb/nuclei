//! Shadow-mode hardware analysis executors: `plan_hardware_run` (port of the
//! toolExecutors.ts case) and `preview_backend_transpilation` (port of
//! `transpilePreviewExecutor.ts`). Neither submits a job or contacts a
//! provider — both are analysis over data already in hand. Never throw.

use serde_json::{json, Value};

use crate::dirac::analysis::{estimate_resources, plan_hardware_run, BackendInfo};
use crate::dirac::kernel::{TranspileOutcome, TranspileTarget};

use super::{
    ev_fail, ev_ok, get_str, parse_active, resolve_framework, resolve_path, ToolContext,
    ToolEvidence,
};

// --- plan_hardware_run ------------------------------------------------------

pub fn exec_plan_hardware_run(input: &Value, id: &str, ctx: &mut ToolContext) -> ToolEvidence {
    let (_path, snapshot) = match parse_active(ctx, input, "plan_hardware_run", id) {
        Ok(pair) => pair,
        Err(ev) => return ev,
    };

    let backends = (ctx.get_backends)();
    if backends.is_empty() {
        return ev_ok(
            "plan_hardware_run",
            id,
            json!({ "available": false, "message": "No connected hardware backends to plan against." }),
        );
    }

    let plan = plan_hardware_run(&snapshot, &backends);
    let candidates: Vec<Value> = plan
        .candidates
        .iter()
        .map(
            |c| json!({ "name": c.backend.name, "provider": c.backend.provider, "score": c.score }),
        )
        .collect();
    let rejected: Vec<Value> = plan
        .rejected
        .iter()
        .map(|r| json!({ "name": r.backend.name, "reasons": r.reasons }))
        .collect();

    ev_ok(
        "plan_hardware_run",
        id,
        json!({
            "available": true,
            "selected": plan.selected.map(|b| b.name),
            "candidates": candidates,
            "rejected": rejected,
            "rationale": plan.rationale,
        }),
    )
}

// --- preview_backend_transpilation ------------------------------------------

const TOOL: &str = "preview_backend_transpilation";

/// Requested backend by name, or the first online backend when no name was
/// given. Returns `None` (never panics) when nothing qualifies.
fn pick_backend(backends: &[BackendInfo], requested: Option<&str>) -> Option<BackendInfo> {
    match requested {
        Some(name) => backends.iter().find(|b| b.name == name).cloned(),
        None => backends.iter().find(|b| b.status == "online").cloned(),
    }
}

/// Map a backend's advertised capabilities to a qiskit transpile target. Empty
/// gate sets / connectivity are omitted so the kernel treats them as "no
/// constraint" rather than an impossible zero-gate/zero-edge target.
fn target_from_backend(backend: &BackendInfo) -> TranspileTarget {
    let mut target = TranspileTarget::default();
    if !backend.gate_set.is_empty() {
        target.basis_gates = Some(backend.gate_set.iter().map(|g| g.to_lowercase()).collect());
    }
    if !backend.connectivity.is_empty() {
        target.coupling_map = Some(backend.connectivity.clone());
    }
    target
}

fn transpile_note(
    pre_two_qubit: Option<usize>,
    post_depth: u32,
    post_two_qubit: u32,
    backend: &str,
) -> String {
    match pre_two_qubit {
        None => format!("Post-transpile on {backend}: depth {post_depth}, {post_two_qubit} two-qubit gates."),
        Some(pre) => format!(
            "Two-qubit gate count went from {pre} pre-transpile to {post_two_qubit} post-transpile on {backend} (post-transpile depth {post_depth})."
        ),
    }
}

pub fn exec_preview_backend_transpilation(
    input: &Value,
    id: &str,
    ctx: &ToolContext,
) -> ToolEvidence {
    let path = resolve_path(input, ctx);
    let Some(file) = ctx.workspace.read_file(&path) else {
        return ev_fail(TOOL, id, &format!("No file at path: {path}"), json!({}));
    };

    let framework = resolve_framework(ctx, &path);
    if framework != "qiskit" {
        return ev_ok(
            TOOL,
            id,
            json!({ "available": false, "message": "Transpilation preview currently supports Qiskit." }),
        );
    }

    let backends = (ctx.get_backends)();
    let requested = get_str(input, "backend");
    let Some(backend) = pick_backend(&backends, requested.as_deref()) else {
        let message = match requested {
            Some(name) => format!("Backend not available: {name}"),
            None => "No online hardware backends to preview transpilation against.".to_string(),
        };
        return ev_ok(TOOL, id, json!({ "available": false, "message": message }));
    };

    let target = target_from_backend(&backend);
    match ctx.kernel.transpile(&file.content, &target) {
        TranspileOutcome::Err { message } => ev_fail(
            TOOL,
            id,
            &message,
            json!({ "path": path, "backend": backend.name }),
        ),
        TranspileOutcome::Ok { metrics } => {
            let pre_two_qubit = ctx
                .last_snapshot
                .as_ref()
                .map(|s| estimate_resources(s).two_qubit_gate_count);
            let note = transpile_note(
                pre_two_qubit,
                metrics.depth,
                metrics.two_qubit_count,
                &backend.name,
            );
            ev_ok(
                TOOL,
                id,
                json!({
                    "available": true,
                    "path": path,
                    "backend": backend.name,
                    "metrics": metrics,
                    "note": note,
                }),
            )
        }
    }
}
