pub mod agent_runtime;
mod commands;

use agent_runtime::process::ProcessSupervisor;
use agent_runtime::AgentRuntimeState;
use commands::kernel::KernelState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kernel_state = KernelState::new();
    let agent_runtime_state = AgentRuntimeState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(kernel_state)
        .manage(agent_runtime_state)
        .invoke_handler(tauri::generate_handler![
            commands::kernel::start_kernel,
            commands::kernel::stop_kernel,
            commands::frameworks::framework_status,
            commands::frameworks::framework_install,
            commands::agent_runtime::agent_sandbox_execute,
            commands::agent_runtime::agent_sandbox_cancel,
            commands::agent_runtime::agent_sandbox_capability,
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    app.state::<AgentRuntimeState>()
                        .supervisor
                        .cancel_all()
                        .await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
