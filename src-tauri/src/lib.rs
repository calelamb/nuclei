pub mod commands;
// The Dirac trusted-runtime harness is the crate's agent API surface: the R4
// orchestrator, model gateway, execution port, policy/budget, and analysis are
// consumed by the R5 Tauri command layer (and are a legitimate library API for
// the `app_lib` rlib). Exposing the module makes those items reachable from a
// live crate root, so the trusted-runtime code needs no blanket dead_code
// allows to build warning-clean under `-D warnings`.
pub mod dirac;

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
            let log_level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log_level)
                    .build(),
            )?;
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kernel cleanup happens via KernelState Drop
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
