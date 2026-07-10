//! Tauri command wrappers for the agent runner (Stage R5a) + the run registry.
//!
//! These are thin: [`dirac_start_run`] mints a run id, registers a cancel flag,
//! resolves the worker/python, spawns a background thread that builds real
//! dependencies and calls [`drive_run`], and returns immediately. Progress is
//! streamed to the frontend via the `dirac://run-event` window event.
//! [`dirac_cancel_run`] flips the run's cancel flag.
//!
//! ## Gateway threading
//!
//! [`ModelGateway`] owns `Box<dyn SecretStore/ModelTransport>` and is NOT
//! `Clone` or `Sync`-shareable across the spawned thread. Rather than fight to
//! move the Tauri-managed instance into the thread, the thread constructs its
//! OWN [`ModelGateway::default`]: [`KeyringStore`] reads the SAME OS-keychain
//! entry and [`HttpTransport`] is stateless, so the run's gateway is functionally
//! identical. The managed `State<ModelGateway>` therefore only backs the
//! `dirac_set_api_key` / `dirac_has_api_key` / `dirac_clear_api_key` commands.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{Emitter, State};

use super::analysis::BackendInfo;
use super::gateway::ModelGateway;
use super::kernel::RealKernel;
use super::orchestrator::GatewayModel;
use super::policy::AutonomyPolicy;
use super::runner::{drive_run, RunConfig, RunDeps, RunEvent, RunSeedFile};
use super::submit::UnavailableSubmitPort;

/// The window event channel every run streams its [`RunEvent`]s over.
const RUN_EVENT: &str = "dirac://run-event";

/// Tauri-managed registry mapping an in-flight run id to its cancel flag. Cloned
/// (the inner `Arc` is shared) into each run's thread so the thread can
/// deregister itself on completion.
#[derive(Clone, Default)]
pub struct DiracRuns {
    inner: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl DiracRuns {
    /// Register a fresh cancel flag for `run_id` and return a handle to it.
    fn register(&self, run_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.inner.lock() {
            map.insert(run_id.to_string(), flag.clone());
        }
        flag
    }

    /// Drop a completed run from the registry.
    fn remove(&self, run_id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(run_id);
        }
    }

    /// Set a run's cancel flag. Returns whether a matching run was found.
    fn cancel(&self, run_id: &str) -> bool {
        if let Ok(map) = self.inner.lock() {
            if let Some(flag) = map.get(run_id) {
                flag.store(true, Ordering::SeqCst);
                return true;
            }
        }
        false
    }
}

static RUN_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A process-unique run id (time-seeded + monotonic counter), matching the
/// orchestrator's id shape.
fn new_run_id() -> String {
    let n = RUN_COUNTER.fetch_add(1, Ordering::SeqCst);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("run_{ms:x}_{n}")
}

/// Start an agent run in the background and return its id immediately. Progress
/// is delivered as [`RunEvent`]s on the `dirac://run-event` window event; call
/// [`dirac_cancel_run`] with the returned id to stop it early.
///
/// The `gateway` state is intentionally not used here — see the module docs on
/// gateway threading; the run thread builds its own gateway from the same
/// keychain entry.
#[tauri::command]
pub fn dirac_start_run(
    app: tauri::AppHandle,
    gateway: State<'_, ModelGateway>,
    runs: State<'_, DiracRuns>,
    goal: String,
    files: Vec<RunSeedFile>,
    active_path: String,
    model: String,
) -> Result<String, String> {
    let _ = &gateway; // see module docs: the run thread builds its own gateway.

    // Resolve the worker up front so a missing worker fails the command
    // synchronously rather than only surfacing as an in-run error event.
    let (worker_script, cwd) = super::resolve_worker_paths(&app)?;

    let run_id = new_run_id();
    let cancel = runs.register(&run_id);
    let runs_handle: DiracRuns = runs.inner().clone();
    let app_for_thread = app.clone();
    let run_id_for_thread = run_id.clone();

    std::thread::spawn(move || {
        let python = super::resolve_python(&app_for_thread);
        let kernel = RealKernel::new(python, worker_script, cwd);

        let gateway = ModelGateway::default();
        let model_port = GatewayModel::new(&gateway).with_model(model.clone());
        let submit = UnavailableSubmitPort;
        let policy = AutonomyPolicy::safe_default();
        let get_backends = || Vec::<BackendInfo>::new();

        let emit = |event: RunEvent| {
            if let Err(e) = app_for_thread.emit(RUN_EVENT, &event) {
                // A failed emit must never break the run loop — log and move on.
                log::warn!("dirac run {run_id_for_thread}: failed to emit run event: {e}");
            }
        };

        let config = RunConfig {
            goal,
            files,
            active_path,
            model,
            run_id: run_id_for_thread.clone(),
        };
        let deps = RunDeps {
            model: &model_port,
            kernel: &kernel,
            submit: &submit,
            policy: &policy,
            get_backends: &get_backends,
        };

        let _ = drive_run(&config, deps, cancel.as_ref(), &emit);
        runs_handle.remove(&run_id_for_thread);
    });

    Ok(run_id)
}

/// Request cancellation of an in-flight run. Returns whether a matching run was
/// found; the run observes the flag at its next loop iteration.
#[tauri::command]
pub fn dirac_cancel_run(runs: State<'_, DiracRuns>, run_id: String) -> bool {
    runs.cancel(&run_id)
}
