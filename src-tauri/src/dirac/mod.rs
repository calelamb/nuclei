//! Dirac trusted-runtime harness (Rust).
//!
//! Stage R1 covers the **execution supervisor**: the Rust↔Python boundary that
//! runs one model-generated quantum request (parse/simulate/transpile) inside
//! the disposable Python worker (`kernel/agent_worker.py`), isolated in its own
//! process group with a hard wall-timeout that kills the whole group. Quantum
//! work stays in Python; Rust owns supervision, limits, and framing.

pub mod executor;
pub mod types;

pub use executor::{run_agent_request, DEFAULT_WALL};
pub use types::{AgentExecuteRequest, AgentExecuteResponse};

use std::path::PathBuf;
use tauri::Manager;

/// Run one agent request in the disposable worker and return a structured
/// response. Worker failures are returned as an `AgentExecuteResponse` with
/// `status: "error"`, never as a Tauri `Err`; the `Result` is reserved for
/// path-resolution failures that mean the worker could not even be located.
#[tauri::command]
pub fn dirac_execute(
    app_handle: tauri::AppHandle,
    request: AgentExecuteRequest,
) -> AgentExecuteResponse {
    let request_id = request.request_id.clone();

    let (worker_script, cwd) = match resolve_worker_paths(&app_handle) {
        Ok(pair) => pair,
        Err(e) => {
            return AgentExecuteResponse::error(request_id, "worker_path_error", &e);
        }
    };

    // Prefer the Nuclei-managed venv's Python (same resolution the kernel uses).
    // Fall back to system `python3` if the managed venv can't be bootstrapped.
    let python = match crate::commands::frameworks::ensure_kernel_runtime(&app_handle) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("Managed venv unavailable ({e}); falling back to system python3");
            PathBuf::from("python3")
        }
    };

    log::info!(
        "dirac_execute: {} -I {} (cwd: {})",
        python.display(),
        worker_script.display(),
        cwd.display()
    );

    run_agent_request(&python, &worker_script, &cwd, &request, DEFAULT_WALL)
}

/// Resolve the bundled `agent_worker.py` and its cwd the same way `kernel.rs`
/// resolves `server.py`: repo root in dev, `resource_dir` in prod. The script
/// is canonicalized and confirmed to live under the cwd, guarding against a
/// rogue symlink redirecting the worker elsewhere.
fn resolve_worker_paths(app_handle: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let (worker_script, cwd) = if cfg!(debug_assertions) {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .map(PathBuf::from)
            .map_err(|_| "CARGO_MANIFEST_DIR not set in dev build".to_string())?;
        let repo_root = manifest_dir
            .parent()
            .ok_or_else(|| format!("No parent for manifest dir {}", manifest_dir.display()))?
            .to_path_buf();
        (repo_root.join("kernel").join("agent_worker.py"), repo_root)
    } else {
        let resource_dir = app_handle
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?;
        let kernel_dir = resource_dir.join("kernel");
        (kernel_dir.join("agent_worker.py"), resource_dir)
    };

    let worker_script = worker_script.canonicalize().map_err(|_| {
        format!(
            "Agent worker script not found at: {} (cwd: {})",
            worker_script.display(),
            cwd.display()
        )
    })?;

    if !worker_script.starts_with(&cwd) {
        return Err("Agent worker script resolved outside expected directory".to_string());
    }

    Ok((worker_script, cwd))
}
