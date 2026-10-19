pub mod cli;
pub mod commands;
// The Dirac trusted-runtime harness is the crate's agent API surface: the R4
// orchestrator, model gateway, execution port, policy/budget, and analysis are
// consumed by the R5 Tauri command layer (and are a legitimate library API for
// the `app_lib` rlib). Exposing the module makes those items reachable from a
// live crate root, so the trusted-runtime code needs no blanket dead_code
// allows to build warning-clean under `-D warnings`.
pub mod dirac;
pub mod logging;

use commands::kernel::KernelState;
use commands::qec_data::QecDataManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kernel_state = KernelState::new();
    let qec_data_state = QecDataManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(kernel_state)
        .manage(qec_data_state)
        .manage(dirac::ModelGateway::default())
        .manage(dirac::DiracRuns::default())
        .invoke_handler(tauri::generate_handler![
            commands::kernel::start_kernel,
            commands::kernel::stop_kernel,
            commands::kernel::kernel_auth_token,
            commands::qec_data::qec_data_start,
            commands::qec_data::qec_data_stop,
            commands::qec_data::qec_data_status,
            commands::frameworks::framework_status,
            commands::frameworks::framework_install,
            commands::frameworks::framework_resolve,
            commands::frameworks::framework_uninstall,
            commands::frameworks::python_setup,
            commands::frameworks::python_install,
            commands::frameworks::environment_report,
            commands::frameworks::venv_repair,
            logging::open_logs,
            commands::git_info::git_project_info,
            commands::qec_study::qec_create_study_manifest,
            commands::qec_study::qec_read_study_manifests,
            dirac::dirac_execute,
            dirac::dirac_set_api_key,
            dirac::dirac_has_api_key,
            dirac::dirac_clear_api_key,
            dirac::commands::dirac_start_run,
            dirac::commands::dirac_cancel_run,
        ])
        .setup(|app| {
            app.handle()
                .plugin(logging::plugin(cfg!(debug_assertions)))?;
            logging::log_startup_report(app.handle());
            commands::kernel::health::spawn_monitor(app.handle().clone());
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kernel cleanup happens via KernelState Drop
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if is_shutdown_event(&event) {
                stop_child_processes(app_handle);
            }
        });
}

/// Tauri never drops managed state on exit, so `KernelState`'s `Drop` does
/// not run on Quit: without this the kernel (and its token file) outlived
/// the app until the next launch reaped it.
fn is_shutdown_event(event: &tauri::RunEvent) -> bool {
    matches!(event, tauri::RunEvent::Exit)
}

fn stop_child_processes(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    app_handle.state::<KernelState>().stop();
    if let Err(e) = app_handle.state::<QecDataManager>().stop() {
        log::warn!("Could not stop the QEC data engine on exit: {e:?}");
    }
}

#[cfg(test)]
mod tests {
    use super::is_shutdown_event;

    #[test]
    fn only_exit_triggers_child_shutdown() {
        assert!(is_shutdown_event(&tauri::RunEvent::Exit));
        assert!(!is_shutdown_event(&tauri::RunEvent::Ready));
        assert!(!is_shutdown_event(&tauri::RunEvent::Resumed));
    }
}
